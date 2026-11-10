package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	deployment "shippin.cloud/vaultix/compose"
	"shippin.cloud/vaultix/internal/release"
)

type Options struct {
	Directory, Project, SiteURL, BuildReceipt, Bundle, Trust, Apply, Environment string
	Port                                                                         int
	Plan, DiscardWrites                                                          bool
	ProxyBindings                                                                []string
}

// rehearsalError means the live store was not touched, so the previous
// application can return without any data decision.
type rehearsalError struct{ cause error }

func (e *rehearsalError) Error() string { return e.cause.Error() }

// rehearsalOutcome keeps an operator's interrupt theirs to decide. Anything else,
// including the time limit, means this rehearsal will not pass.
func rehearsalOutcome(ctx context.Context, err error) error {
	switch ctx.Err() {
	case context.Canceled:
		return err
	case context.DeadlineExceeded:
		return &rehearsalError{errors.New("it did not finish within the command's time limit")}
	}
	return &rehearsalError{err}
}

type Result struct {
	Instance         Instance `json:"instance"`
	Operation        *State   `json:"operation"`
	Ready            bool     `json:"ready"`
	RecoveryRequired bool     `json:"recoveryRequired"`
	Message          string   `json:"message"`
	// Present only while the running application still requires the first-owner code.
	SetupCode string `json:"setupCode,omitempty"`
	SetupURL  string `json:"setupUrl,omitempty"`
}

func Execute(ctx context.Context, action string, o Options, progress io.Writer) (Result, error) {
	var result Result
	if o.Directory == "" {
		return result, errors.New("--directory is required")
	}
	if o.Project == "" {
		o.Project = "vaultix"
	}
	if o.Port == 0 {
		o.Port = 8200
	}
	bindings, err := parseProxyBindings(o.ProxyBindings, o.Port)
	if err != nil {
		return result, err
	}
	if len(bindings) != 0 && action != "install" && action != "adopt" {
		return result, errors.New("--proxy-bind is only for install or adopt; upgrades use the saved listeners")
	}
	if action != "install" && action != "upgrade" && action != "status" && action != "recover" && action != "adopt" && action != "rollback" {
		return result, errors.New("use server install, upgrade, adopt, status, recover or rollback")
	}
	if o.Apply != "" && action != "upgrade" || o.DiscardWrites && action != "rollback" || o.Environment != "" && action != "install" && action != "adopt" || (action == "adopt" || action == "status" || action == "rollback") && (o.BuildReceipt != "" || o.Bundle != "" || o.Trust != "" || o.Plan) {
		return result, errors.New("arguments do not belong to the selected server operation")
	}
	root, err := privateDirectory(o.Directory, action == "install" || action == "adopt")
	if err != nil {
		return result, err
	}
	lock, err := os.OpenFile(filepath.Join(root, "operation.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return result, err
	}
	defer lock.Close()
	info, err := os.Lstat(lock.Name())
	if err != nil || !info.Mode().IsRegular() {
		return result, errors.New("invalid operation lock")
	}
	opened, err := lock.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return result, errors.New("operation lock changed")
	}
	if err = lockFile(lock); err != nil {
		return result, err
	}
	defer unlockFile(lock)
	s, err := loadState(root)
	if err != nil {
		return result, err
	}
	var instance Instance
	if raw, readErr := privateRead(configPath(root, "instance.json"), 65536); readErr == nil {
		if err = decode(raw, &instance); err != nil {
			return result, err
		}
		if err = instance.validate(); err != nil {
			return result, err
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return result, readErr
	} else if action != "install" && action != "adopt" {
		return result, errors.New("instance not enrolled; use install for a new instance or adopt for an existing one")
	}
	d, err := newDocker(root, instance)
	if err != nil {
		return result, err
	}
	daemon, err := d.daemon(ctx)
	if err != nil {
		return result, err
	}
	if instance.SchemaVersion != "" && instance.Daemon != daemon {
		return result, errors.New("Docker target changed; operation refused")
	}
	if action == "status" {
		result = Result{Instance: instance, Operation: s, RecoveryRequired: s != nil && s.Phase != "ready"}
		if s != nil && s.Phase == "ready" {
			result.Ready = d.healthy(ctx, s.Candidate.Image) == nil
		}
		if result.Ready {
			withSetupCode(ctx, d, root, &result)
		}
		return result, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	if action == "rollback" {
		if s == nil {
			return result, errors.New("no operation to roll back")
		}
		next, err := rollbackState(s, o.DiscardWrites)
		if err != nil {
			return result, err
		}
		if err = d.rollbackPreflight(ctx, next); err != nil {
			return result, err
		}
		phase := "reverting"
		if s.Phase == "planned" {
			phase = "ready"
		}
		if err = saveState(root, next, phase); err != nil {
			return result, err
		}
		s = next
	} else if action == "recover" || o.Apply != "" {
		if s == nil || s.Phase == "ready" {
			return result, errors.New("no pending operation")
		}
		if o.Apply != "" && o.Apply != s.Operation {
			return result, errors.New("operation ID does not match the saved plan")
		}
		if o.BuildReceipt != "" || o.Bundle != "" || o.Trust != "" || o.Environment != "" || o.Plan {
			return result, errors.New("recovery/apply uses the saved selection; new selection arguments are refused")
		}
	} else {
		if s != nil && s.Phase != "ready" {
			return result, errors.New("an operation is pending; inspect status and recover it")
		}
		if (action == "install" || action == "adopt") && s != nil {
			return result, errors.New("instance already exists; use upgrade")
		}
		if action == "upgrade" && s == nil {
			return result, errors.New("install or adopt the instance first")
		}
		var prior *release.ReleaseCheckpoint
		if s != nil {
			prior = newestCheckpoint(s.RetainedCheckpoint, s.Candidate.Checkpoint)
		}
		var target Candidate
		if action != "adopt" {
			target, err = candidate(ctx, d, o, prior)
			if err != nil {
				return result, err
			}
		}
		if instance.SchemaVersion == "" {
			if o.Project == "" {
				o.Project = "vaultix"
			}
			if !namePattern.MatchString(o.Project) {
				return result, errors.New("invalid Compose project name")
			}
			if o.Port == 0 {
				o.Port = 8200
			}
			if o.Port < 1 || o.Port > 65535 {
				return result, errors.New("invalid listen port")
			}
			u, parseErr := url.Parse(o.SiteURL)
			if parseErr != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
				return result, errors.New("--site-url must be an HTTPS origin or loopback HTTP origin")
			}
			instance = Instance{SchemaVersion: Schema, ID: "instance-" + randomHex(12), Project: o.Project, SiteURL: strings.TrimRight(o.SiteURL, "/"), Port: o.Port, Daemon: daemon}
			if len(bindings) != 0 {
				instance.SchemaVersion = InstanceSchema
				instance.ProxyBindings = bindings
			}
			if err = instance.validate(); err != nil {
				return result, err
			}
			d.instance = instance
			if action == "install" {
				for _, name := range []string{"backend", "db", "cache"} {
					c, err := d.service(ctx, name)
					if err != nil {
						return result, err
					}
					if c != nil {
						return result, errors.New("Compose project already has services; use adopt")
					}
				}
			}
			if err = initialize(root, instance, o.Environment, action == "adopt"); err != nil {
				return result, err
			}
		} else if action == "install" || action == "adopt" {
			if o.Project != instance.Project || strings.TrimRight(o.SiteURL, "/") != instance.SiteURL || o.Port != instance.Port || !slices.Equal(bindings, instance.ProxyBindings) {
				return result, errors.New("partial initialization exists; resume with its original options")
			}
		}
		d.instance = instance
		if action == "adopt" {
			current, err := d.service(ctx, "backend")
			if err != nil || current == nil {
				return result, errors.New("existing backend was not found")
			}
			metadata, err := d.run(ctx, "image", "inspect", "--format", `{{index .Config.Labels "org.opencontainers.image.revision"}}`, current.Image)
			if err != nil {
				return result, err
			}
			target = Candidate{Image: current.Image, Revision: string(metadata), Evidence: digest([]byte(current.Image)), Trust: "existing-instance"}
			if err = d.image(ctx, target.Image, target.Revision); err != nil {
				return result, err
			}
			target.Migrations, err = d.migrations(ctx, target.Image)
			if err != nil {
				return result, err
			}
		}
		fingerprint, err := configuration(root)
		if err != nil {
			return result, err
		}
		// The newest verified release outlives a local build or a cancelled plan, so
		// neither reopens replay of an older signed one.
		next := &State{Operation: "op-" + randomHex(12), Action: action, Configuration: fingerprint, Candidate: target, RetainedCheckpoint: prior}
		if action != "install" {
			current, err := d.service(ctx, "backend")
			if err != nil || current == nil {
				return result, errors.New("existing backend was not found")
			}
			next.PriorContainer = current.ID
			next.PriorImage = current.Image
			if action == "upgrade" && current.Image != s.Candidate.Image {
				return result, errors.New("running image changed outside this operation owner")
			}
			if err = d.healthy(ctx, current.Image); err != nil {
				return result, err
			}
			if err = bindDependencies(ctx, d, next); err != nil {
				return result, err
			}
			if err = d.runtimeConfiguration(ctx, next.PriorContainer, next.PriorImage); err != nil {
				return result, err
			}
			if action == "upgrade" {
				prior := s.Candidate
				next.Prior = &prior
				next.Migration, err = d.planSchema(ctx, next, current.Image, target)
				if err != nil {
					return result, err
				}
			}
		}
		if err = d.claim(ctx, target.Image); err != nil {
			return result, err
		}
		phase := "planned"
		if action == "adopt" || action == "upgrade" && target.Image == s.Candidate.Image && fingerprint == s.Configuration {
			phase = "ready"
		}
		if err = saveState(root, next, phase); err != nil {
			return result, err
		}
		s = next
	}
	result = Result{Instance: instance, Operation: s, RecoveryRequired: s.Phase != "ready"}
	if o.Plan || s.Phase == "ready" {
		result.Ready = s.Phase == "ready"
		result.Message = "Saved selection; no application replacement performed."
		if action == "rollback" {
			result.Message = "Cancelled the saved upgrade; the running application was not changed."
		}
		return result, nil
	}
	if err = advance(ctx, d, s, progress); err != nil {
		if saved, loadErr := loadState(root); loadErr == nil && saved != nil {
			result.Operation = saved
			result.Ready = saved.Phase == "ready"
			result.RecoveryRequired = saved.Phase != "ready"
			if saved.Action == "upgrade" && saved.Prior != nil && saved.Prior.Image != saved.Candidate.Image && saved.Phase != "ready" {
				err = fmt.Errorf("%w. Retry with vaultix server recover, or return to the previous application with vaultix server rollback", err)
			}
		}
		result.Message = err.Error()
		return result, err
	}
	result.Operation = s
	result.Ready = true
	result.RecoveryRequired = false
	result.Message = completionMessage(s)
	withSetupCode(ctx, d, root, &result)
	return result, nil
}

// advance runs the saved operation. A failed rehearsal returns the previous
// application at once: nothing live changed, so there is no decision to wait for.
func advance(ctx context.Context, d *Docker, s *State, progress io.Writer) error {
	err := runOperation(ctx, d, s, progress)
	// The time limit can also expire just before the rehearsal itself starts.
	if err != nil && s.Phase == "rehearsing" && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		err = rehearsalOutcome(ctx, err)
	}
	var refused *rehearsalError
	if !errors.As(err, &refused) {
		return err
	}
	next, stateErr := rollbackState(s, false)
	if stateErr == nil {
		stateErr = saveState(d.root, next, "reverting")
	}
	if stateErr == nil {
		*s = *next
		// The time limit may be why the rehearsal ended; it must not also keep the
		// application down.
		restart, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Minute)
		defer cancel()
		stateErr = runOperation(restart, d, s, progress)
	}
	if stateErr != nil {
		return fmt.Errorf("migration rehearsal failed on a restored copy (%v), and the previous application could not be restarted (%v). The live database was not changed. Resume with vaultix server recover", refused, stateErr)
	}
	return fmt.Errorf("upgrade stopped: migration rehearsal failed on a restored copy (%v). The live database was not changed and the previous application is running again", refused)
}

func initialize(root string, i Instance, environment string, adopt bool) error {
	if adopt && environment == "" {
		return errors.New("adopt requires the existing private --env-file")
	}
	if _, err := os.Lstat(filepath.Join(root, "config")); !errors.Is(err, os.ErrNotExist) {
		return errors.New("configuration already exists")
	}
	stage, err := os.MkdirTemp(root, ".configuration-")
	if err != nil {
		return err
	}
	var env []byte
	if environment != "" {
		var err error
		env, err = privateRead(environment, 1024*1024)
		if err != nil {
			return err
		}
	} else {
		text := string(deployment.EnvironmentExample)
		for key, value := range map[string]string{"ENCRYPTION_KEY": randomHex(16), "AUTH_SECRET": randomHex(32), "VAULTIX_ENC_KEY": randomHex(32), "POSTGRES_PASSWORD": randomHex(32), setupCodeKey: newSetupCode(), "SITE_URL": i.SiteURL, "VAULTIX_PUBLIC_HOST": strings.TrimPrefix(strings.TrimPrefix(i.SiteURL, "https://"), "http://")} {
			lines := strings.Split(text, "\n")
			for n, line := range lines {
				if strings.HasPrefix(line, key+"=") {
					lines[n] = key + "=" + value
				}
			}
			text = strings.Join(lines, "\n")
		}
		env = []byte(text)
	}
	// Keep the default listener loopback-only. Additional explicitly enrolled
	// proxy listeners are emitted by selection; TLS/firewall policy stays external.
	env = append(env, []byte("\nVAULTIX_BIND_ADDRESS=127.0.0.1\nVAULTIX_PORT="+strconv.Itoa(i.Port)+"\n")...)
	if err = newFile(filepath.Join(stage, "vaultix.env"), env); err != nil {
		return err
	}
	if err = newFile(filepath.Join(stage, "compose.yml"), deployment.Definition); err != nil {
		return err
	}
	key, err := newRecoveryKey()
	if err != nil {
		return err
	}
	if err = newFile(filepath.Join(stage, "recovery.key"), key); err != nil {
		return err
	}
	if err = newJSON(filepath.Join(stage, "instance.json"), i); err != nil {
		return err
	}
	if err = os.Rename(stage, filepath.Join(root, "config")); err != nil {
		return err
	}
	return syncDirectory(root)
}

func bindDependencies(ctx context.Context, d *Docker, s *State) error {
	db, err := d.service(ctx, "db")
	if err != nil || db == nil || volume(db) == "" {
		return errors.New("managed PostgreSQL service with a named volume is required")
	}
	s.Database = db.ID
	s.DatabaseImage = db.Image
	s.DatabaseVolume = volume(db)
	cache, err := d.service(ctx, "cache")
	if err != nil {
		return err
	}
	if cache != nil {
		s.Cache = cache.ID
	}
	return nil
}

func runOperation(ctx context.Context, d *Docker, s *State, progress io.Writer) error {
	if s.Candidate.Trust == "signed-bundle" && s.Action != "rollback" {
		expiry, err := time.Parse(time.RFC3339, s.Candidate.ExpiresAt)
		if err != nil || !time.Now().Before(expiry) {
			return errors.New("selected signed release has expired; keep the operation for reviewed recovery")
		}
	}
	if fp, err := configuration(d.root); err != nil || fp != s.Configuration {
		return errors.New("configuration changed after planning; saved operation cannot be applied")
	}
	if err := d.image(ctx, s.Candidate.Image, s.Candidate.Revision); err != nil {
		return err
	}
	if migration, err := d.migrations(ctx, s.Candidate.Image); err != nil || migration != s.Candidate.Migrations {
		return errors.New("candidate migration identity changed")
	}
	if err := d.claim(ctx, s.Candidate.Image); err != nil {
		return err
	}
	if s.Action == "rollback" {
		restores := liveStoreChanged(s.Migration, s.RevertedFrom) && (s.Phase == "reverting" || s.Phase == "restoring")
		if err := d.rebindDependencies(ctx, s, restores); err != nil {
			return err
		}
	}
	transition := func(phase string) error {
		if fp, err := configuration(d.root); err != nil || fp != s.Configuration {
			return errors.New("configuration changed during the operation; phase was not advanced")
		}
		if err := saveState(d.root, s, phase); err != nil {
			return err
		}
		fmt.Fprintf(progress, "Vaultix %s: %s\n", s.Operation, phase)
		return nil
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if fp, err := configuration(d.root); err != nil || fp != s.Configuration {
			return errors.New("configuration changed during the operation; effect was not started")
		}
		switch s.Phase {
		case "planned":
			if s.Action == "install" {
				if err := transition("dependencies"); err != nil {
					return err
				}
			} else {
				if err := d.preserved(ctx, s); err != nil {
					return err
				}
				if err := d.runtimeConfiguration(ctx, s.PriorContainer, s.PriorImage); err != nil {
					return err
				}
				if err := transition("stopping"); err != nil {
					return err
				}
			}
		case "dependencies":
			if err := d.dependencies(ctx, s.Candidate.Image); err != nil {
				return err
			}
			if err := bindDependencies(ctx, d, s); err != nil {
				return err
			}
			if err := transition("replacing"); err != nil {
				return err
			}
		case "stopping":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			current, err := d.service(ctx, "backend")
			if err != nil || current == nil || current.ID != s.PriorContainer || current.Image != s.PriorImage {
				return errors.New("application changed before shutdown")
			}
			if err = d.stop(ctx, s.PriorContainer); err != nil {
				return err
			}
			if err = transition("snapshot"); err != nil {
				return err
			}
		case "snapshot":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			old, err := d.inspect(ctx, s.PriorContainer)
			if err != nil || old.State.Running {
				return errors.New("old application must remain stopped during checkpoint")
			}
			if err = checkpoint(ctx, d, s); err != nil {
				return err
			}
			next := "replacing"
			if s.Migration != nil {
				next = "rehearsing"
			}
			if err = transition(next); err != nil {
				return err
			}
		case "rehearsing":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			if err := d.priorStopped(ctx, s); err != nil {
				return err
			}
			if err := checkBackup(d.root, s); err != nil {
				return err
			}
			if err := d.rehearse(ctx, s); err != nil {
				return rehearsalOutcome(ctx, err)
			}
			if err := transition("migrating"); err != nil {
				return err
			}
		case "migrating":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			if err := d.priorStopped(ctx, s); err != nil {
				return err
			}
			if err := checkBackup(d.root, s); err != nil {
				return err
			}
			if err := d.migrateLive(ctx, s); err != nil {
				return err
			}
			if err := transition("replacing"); err != nil {
				return err
			}
		case "reverting":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			if err := d.revert(ctx, s); err != nil {
				return err
			}
			next := "replacing"
			if liveStoreChanged(s.Migration, s.RevertedFrom) {
				next = "restoring"
			}
			if err := transition(next); err != nil {
				return err
			}
		case "restoring":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			// An application started by hand since an interruption must not write to the
			// store being replaced, and the operator has already accepted the restore.
			if err := d.revert(ctx, s); err != nil {
				return err
			}
			if err := d.restoreStore(ctx, s); err != nil {
				return err
			}
			if err := transition("replacing"); err != nil {
				return err
			}
		case "replacing":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			if s.Action == "upgrade" {
				if err := checkBackup(d.root, s); err != nil {
					return err
				}
			}
			if err := d.replace(ctx, s.Candidate.Image); err != nil {
				return err
			}
			if err := transition("validating"); err != nil {
				return err
			}
		case "validating":
			if err := d.preserved(ctx, s); err != nil {
				return err
			}
			if err := d.healthy(ctx, s.Candidate.Image); err != nil {
				return err
			}
			if err := transition("ready"); err != nil {
				return err
			}
		case "ready":
			return nil
		default:
			return errors.New("operation cannot resume from this phase")
		}
	}
}

func checkpoint(ctx context.Context, d *Docker, s *State) error {
	key, err := privateRead(configPath(d.root, "recovery.key"), 8192)
	if err != nil {
		return errors.New("recovery key is unavailable")
	}
	user, db, err := d.dbNames(ctx, s.Database)
	if err != nil {
		return err
	}
	// Every interrupted attempt gets new files and a new salt. No existing backup
	// is truncated, replaced or removed to make recovery appear successful.
	name := s.Operation + "-" + randomHex(6) + ".database.age"
	file, err := os.OpenFile(filepath.Join(d.root, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	reader, writer := io.Pipe()
	result := make(chan error, 1)
	go func() {
		err := d.stream(ctx, nil, writer, "exec", s.Database, "pg_dump", "-U", user, "-d", db, "--format=custom", "--no-owner", "--no-acl")
		writer.CloseWithError(err)
		result <- err
	}()
	err = encryptBackup(file, reader, key)
	reader.Close()
	dumpErr := <-result
	if err == nil {
		err = dumpErr
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	s.Backup = name
	s.BackupHash, err = fileDigest(filepath.Join(d.root, name))
	if err != nil {
		return err
	}
	env, err := privateRead(configPath(d.root, "vaultix.env"), 1024*1024)
	if err != nil {
		return err
	}
	var sealed bytes.Buffer
	if err = encryptBackup(&sealed, bytes.NewReader(env), key); err != nil {
		return err
	}
	if err = newFile(filepath.Join(d.root, name+".environment"), sealed.Bytes()); err != nil {
		return err
	}
	s.EnvironmentHash = digest(sealed.Bytes())
	if err = d.restoreProbe(ctx, s, key); err != nil {
		return err
	}
	if s.Migration != nil {
		user, db, err := d.dbNames(ctx, s.Database)
		if err != nil {
			return err
		}
		if s.Migration.Secrets, err = d.secretsFingerprint(ctx, s.Database, user, db); err != nil {
			return err
		}
	}
	return checkBackup(d.root, s)
}

func fileDigest(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("backup must be a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func checkBackup(root string, s *State) error {
	if filepath.Base(s.Backup) != s.Backup || !strings.HasPrefix(s.Backup, s.Operation+"-") {
		return errors.New("invalid recovery checkpoint path")
	}
	for name, expected := range map[string]string{s.Backup: s.BackupHash, s.Backup + ".environment": s.EnvironmentHash} {
		actual, err := fileDigest(filepath.Join(root, name))
		if err != nil || actual != expected {
			return errors.New("recovery checkpoint changed")
		}
	}
	return nil
}

func (d *Docker) claim(ctx context.Context, image string) error {
	name := "vaultix-owner-" + d.instance.Project
	c, err := d.inspect(ctx, name)
	if err != nil {
		_, err = d.run(ctx, "create", "--name", name, "--network", "none", "--entrypoint", "/bin/true", "--label", "vaultix.lifecycle.instance="+d.instance.ID, "--label", "vaultix.lifecycle.role=instance-owner", image)
		if err != nil {
			return errors.New("instance ownership is already claimed or cannot be established")
		}
		c, err = d.inspect(ctx, name)
		if err != nil {
			return err
		}
	}
	if c.Config.Labels["vaultix.lifecycle.instance"] != d.instance.ID || c.Config.Labels["vaultix.lifecycle.role"] != "instance-owner" || c.State.Running {
		return errors.New("Compose project is owned by another lifecycle directory")
	}
	return nil
}
