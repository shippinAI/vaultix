package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type limitedOutput struct {
	bytes.Buffer
	limit int
}

func (w *limitedOutput) Write(p []byte) (int, error) {
	if w.Len()+len(p) > w.limit {
		return 0, errors.New("Docker response limit")
	}
	return w.Buffer.Write(p)
}

// No shell or operator-provided executable is used. Environment values reach a
// container through compose or a pipe; diagnostics cannot leak their expansions.
type Docker struct {
	executable string
	root       string
	instance   Instance
}

func newDocker(root string, i Instance) (*Docker, error) {
	p, err := exec.LookPath("docker")
	if err != nil {
		return nil, errors.New("Docker with Compose v2 is required")
	}
	return &Docker{p, root, i}, nil
}
func commandEnvironment() []string {
	var result []string
	for _, entry := range os.Environ() {
		key := strings.ToUpper(strings.SplitN(entry, "=", 2)[0])
		if key == "PATH" || key == "HOME" || key == "USERPROFILE" || key == "SYSTEMROOT" || key == "WINDIR" || key == "TEMP" || key == "TMP" || key == "APPDATA" || key == "LOCALAPPDATA" || key == "SSH_AUTH_SOCK" || strings.HasPrefix(key, "DOCKER_") {
			result = append(result, entry)
		}
	}
	return result
}
func (d *Docker) stream(ctx context.Context, input io.Reader, output io.Writer, args ...string) error {
	return d.command(ctx, input, output, io.Discard, args...)
}

// combined captures stderr too, for the rare output that belongs in a private file.
func (d *Docker) combined(ctx context.Context, output io.Writer, args ...string) error {
	return d.command(ctx, nil, output, output, args...)
}
func (d *Docker) command(ctx context.Context, input io.Reader, output, diagnostics io.Writer, args ...string) error {
	cmd := exec.CommandContext(ctx, d.executable, args...)
	cmd.Dir = d.root
	cmd.Env = commandEnvironment()
	cmd.Stdin = input
	cmd.Stdout = output
	cmd.Stderr = diagnostics
	cmd.WaitDelay = 5 * time.Second
	if err := cmd.Run(); err != nil {
		// Name only fixed driver operations, never arguments or raw diagnostics.
		operation := "command"
		if len(args) > 0 {
			switch args[0] {
			case "compose", "image", "container", "create", "rm", "start", "stop", "ps", "info", "run", "wait", "logs":
				operation = args[0]
			case "exec":
				operation = "exec"
				for _, arg := range args {
					switch arg {
					case "pg_dump", "pg_restore", "pg_isready", "psql":
						operation = arg
					}
				}
			}
		}
		exitCode := -1
		var exited *exec.ExitError
		if errors.As(err, &exited) {
			exitCode = exited.ExitCode()
		}
		return fmt.Errorf("Docker %s failed (exit %d); instance state is retained for recovery", operation, exitCode)
	}
	return nil
}
func (d *Docker) run(ctx context.Context, args ...string) ([]byte, error) {
	var out limitedOutput
	out.limit = 4 * 1024 * 1024
	err := d.stream(ctx, nil, &out, args...)
	return bytes.TrimSpace(out.Bytes()), err
}
func (d *Docker) daemon(ctx context.Context) (string, error) {
	raw, err := d.run(ctx, "info", "--format", `{"id":{{json .ID}},"os":{{json .OSType}},"arch":{{json .Architecture}}}`)
	if err != nil {
		return "", err
	}
	var v struct{ ID, OS, Arch string }
	if json.Unmarshal(raw, &v) != nil || v.ID == "" || v.OS != "linux" || (v.Arch != "x86_64" && v.Arch != "amd64") {
		return "", errors.New("a Linux/amd64 Docker engine is required")
	}
	return v.ID, nil
}

type containerInfo struct {
	ID     string `json:"Id"`
	Image  string
	Config struct {
		Env    []string
		Labels map[string]string
	}
	State struct {
		Running  bool
		ExitCode int
		Health   *struct{ Status string }
	}
	Mounts          []struct{ Name, Destination string }
	NetworkSettings struct {
		Ports    map[string][]struct{ HostIp, HostPort string }
		Networks map[string]any
	}
}

func (d *Docker) inspect(ctx context.Context, id string) (containerInfo, error) {
	var list []containerInfo
	raw, err := d.run(ctx, "container", "inspect", id)
	if err != nil {
		return containerInfo{}, err
	}
	if json.Unmarshal(raw, &list) != nil || len(list) != 1 {
		return containerInfo{}, errors.New("invalid Docker container response")
	}
	return list[0], nil
}
func (d *Docker) service(ctx context.Context, name string) (*containerInfo, error) {
	raw, err := d.run(ctx, "ps", "-a", "--filter", "label=com.docker.compose.project="+d.instance.Project, "--filter", "label=com.docker.compose.service="+name, "--format", "{{.ID}}")
	if err != nil {
		return nil, err
	}
	ids := strings.Fields(string(raw))
	if len(ids) == 0 {
		return nil, nil
	}
	if len(ids) != 1 {
		return nil, errors.New("replicated services require the fleet upgrade adapter")
	}
	c, err := d.inspect(ctx, ids[0])
	if err != nil {
		return nil, err
	}
	return &c, nil
}
func envMap(entries []string) map[string]string {
	v := map[string]string{}
	for _, e := range entries {
		a := strings.SplitN(e, "=", 2)
		if len(a) == 2 {
			v[a[0]] = a[1]
		}
	}
	return v
}
func volume(c *containerInfo) string {
	if c == nil {
		return ""
	}
	for _, m := range c.Mounts {
		if m.Destination == "/var/lib/postgresql/data" {
			return m.Name
		}
	}
	return ""
}

func (d *Docker) selection(image string) (string, error) {
	if !imagePattern.MatchString(image) {
		return "", errors.New("an immutable image ID is required")
	}
	path := filepath.Join(d.root, "selection-"+strings.TrimPrefix(image, "sha256:")+".json")
	label := map[string]string{"vaultix.lifecycle.instance": d.instance.ID}
	backend := map[string]any{"image": image, "labels": label}
	if len(d.instance.ProxyBindings) != 0 {
		var ports []map[string]any
		for _, binding := range d.instance.ProxyBindings {
			ports = append(ports, map[string]any{"target": 8080, "published": strconv.Itoa(binding.Port), "host_ip": binding.HostIP, "protocol": "tcp"})
		}
		// Compose merges by IP/target/published/protocol, preserving the canonical
		// loopback binding while adding these explicitly enrolled listeners.
		backend["ports"] = ports
	}
	data, _ := json.Marshal(map[string]any{"services": map[string]any{"backend": backend, "db": map[string]any{"labels": label}, "cache": map[string]any{"labels": label}}})
	data = append(data, '\n')
	if existing, err := privateRead(path, 65536); err == nil {
		if !bytes.Equal(existing, data) {
			return "", errors.New("image selection changed")
		}
	} else if errors.Is(err, os.ErrNotExist) {
		if err = newFile(path, data); err != nil {
			return "", err
		}
	} else {
		return "", err
	}
	return path, nil
}
func (d *Docker) composeArgs(image string, args ...string) ([]string, error) {
	path, err := d.selection(image)
	if err != nil {
		return nil, err
	}
	base := []string{"compose", "--project-name", d.instance.Project, "--project-directory", filepath.Join(d.root, "config"), "--env-file", configPath(d.root, "vaultix.env"), "-f", configPath(d.root, "compose.yml"), "-f", path}
	return append(base, args...), nil
}
func (d *Docker) compose(ctx context.Context, image string, args ...string) ([]byte, error) {
	all, err := d.composeArgs(image, args...)
	if err != nil {
		return nil, err
	}
	return d.run(ctx, all...)
}
func (d *Docker) dependencies(ctx context.Context, image string) error {
	raw, err := d.compose(ctx, image, "config", "--services")
	if err != nil {
		return err
	}
	services := []string{"db"}
	for _, name := range strings.Fields(string(raw)) {
		if name == "cache" {
			services = append(services, "cache")
		}
	}
	args := append([]string{"up", "-d", "--no-build", "--wait", "--wait-timeout", "180"}, services...)
	_, err = d.compose(ctx, image, args...)
	return err
}
func (d *Docker) replace(ctx context.Context, image string) error {
	_, err := d.compose(ctx, image, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "backend")
	return err
}
func (d *Docker) stop(ctx context.Context, id string) error {
	if _, err := d.run(ctx, "stop", "--signal", "SIGTERM", "--timeout", "90", id); err != nil {
		return err
	}
	c, err := d.inspect(ctx, id)
	if err != nil {
		return err
	}
	if c.State.Running || c.State.ExitCode != 0 {
		return errors.New("application did not shut down cleanly; investigate before recovery")
	}
	return nil
}
func (d *Docker) healthy(ctx context.Context, image string) error {
	c, err := d.service(ctx, "backend")
	if err != nil {
		return err
	}
	if c == nil || c.Image != image || !c.State.Running || c.State.Health == nil || c.State.Health.Status != "healthy" {
		return errors.New("selected application is not healthy")
	}
	return d.runtimeConfiguration(ctx, c.ID, c.Image)
}
func (d *Docker) preserved(ctx context.Context, s *State) error {
	db, err := d.service(ctx, "db")
	if err != nil {
		return err
	}
	if db == nil || db.ID != s.Database || db.Image != s.DatabaseImage || volume(db) != s.DatabaseVolume {
		return errors.New("database identity or volume changed")
	}
	cache, err := d.service(ctx, "cache")
	if err != nil {
		return err
	}
	if (cache == nil && s.Cache != "") || (cache != nil && cache.ID != s.Cache) {
		return errors.New("cache service identity changed")
	}
	return nil
}
func (d *Docker) applicationEnvironment(ctx context.Context, image string) (map[string]string, error) {
	raw, err := d.compose(ctx, image, "config", "--format", "json")
	if err != nil {
		return nil, err
	}
	var cfg struct {
		Services map[string]struct{ Environment map[string]string }
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return nil, errors.New("cannot validate instance configuration")
	}
	return cfg.Services["backend"].Environment, nil
}
func (d *Docker) runtimeConfiguration(ctx context.Context, container, image string) error {
	current, err := d.inspect(ctx, container)
	if err != nil {
		return err
	}
	expected, err := d.applicationEnvironment(ctx, image)
	if err != nil {
		return err
	}
	actual := envMap(current.Config.Env)
	defaultsRaw, err := d.run(ctx, "image", "inspect", "--format", "{{json .Config.Env}}", current.Image)
	if err != nil {
		return err
	}
	var defaults []string
	if json.Unmarshal(defaultsRaw, &defaults) != nil {
		return errors.New("cannot inspect application configuration defaults")
	}
	if err = preserveEnvironment(expected, actual, envMap(defaults)); err != nil {
		return err
	}
	if expected["SITE_URL"] != d.instance.SiteURL {
		return errors.New("site origin differs from the enrolled instance")
	}
	if !d.instance.matchesPorts(current.NetworkSettings.Ports) {
		return errors.New("application port bindings differ from the enrolled configuration; adopt with every existing additional listener declared by --proxy-bind IP:PORT")
	}
	if len(current.Mounts) != 0 || len(current.NetworkSettings.Networks) != 1 || current.NetworkSettings.Networks[d.instance.Project+"_default"] == nil {
		return errors.New("deployment mounts or networks differ from the supported single-instance Compose layout; retain the existing deployment owner")
	}
	return nil
}

// Compare the complete operator environment, including provider credentials,
// policy and every supported cache topology. Image-inherited defaults may be
// absent from Compose; silently dropped explicit settings may not.
func preserveEnvironment(expected, actual, defaults map[string]string) error {
	for _, key := range []string{"ENCRYPTION_KEY", "AUTH_SECRET", "DB_CONNECTION_URI", "SITE_URL"} {
		if expected[key] == "" || expected[key] != actual[key] {
			return errors.New("active identity/store configuration differs from the selected configuration")
		}
	}
	control := func(key string) bool { return key == "VAULTIX_BIND_ADDRESS" || key == "VAULTIX_PORT" }
	for key, value := range expected {
		if !control(key) && actual[key] != value {
			return errors.New("selected environment differs from the running application; preserve its complete private configuration")
		}
	}
	for key, value := range actual {
		if _, present := expected[key]; present || control(key) {
			continue
		}
		if inherited, present := defaults[key]; !present || inherited != value {
			return errors.New("selected environment omits an active setting; preserve its complete private configuration")
		}
	}
	return nil
}

func (d *Docker) image(ctx context.Context, id, revision string) error {
	raw, err := d.run(ctx, "image", "inspect", id)
	if err != nil {
		return err
	}
	var list []struct {
		ID           string `json:"Id"`
		OS           string `json:"Os"`
		Architecture string
		Config       struct{ Labels map[string]string }
	}
	if json.Unmarshal(raw, &list) != nil || len(list) != 1 {
		return errors.New("invalid image metadata")
	}
	v := list[0]
	l := v.Config.Labels
	if v.ID != id || v.OS != "linux" || v.Architecture != "amd64" || l["org.opencontainers.image.title"] != "Vaultix" || l["org.opencontainers.image.url"] != "https://vaultix.cloud" || l["org.opencontainers.image.source"] != "https://github.com/shippinAI/vaultix" || l["org.opencontainers.image.revision"] != revision {
		return errors.New("image identity does not match the verified Vaultix candidate")
	}
	return nil
}

// The existing production migration loader reads these .mjs/.ts files. Hash
// their actual bytes; a release label is not enough to authorize schema change.
// The set hash is stable across CLI versions so a saved operation still matches.
const migrationProbe = `const fs=require('fs'),p=require('path'),crypto=require('crypto');const dir='/backend/dist/db/migrations',names=fs.readdirSync(dir).filter(n=>/\.(mjs|ts)$/.test(n)).sort();if(!names.length||names.length>10000)process.exit(1);const h=crypto.createHash('sha256'),files={};for(const n of names){const f=p.join(dir,n);if(!fs.lstatSync(f).isFile())process.exit(1);const b=fs.readFileSync(f);h.update(n+'\0');h.update(b);files[n]=crypto.createHash('sha256').update(b).digest('hex');}process.stdout.write(JSON.stringify({set:h.digest('hex'),files}));`

func (d *Docker) dbNames(ctx context.Context, id string) (string, string, error) {
	c, err := d.inspect(ctx, id)
	if err != nil {
		return "", "", err
	}
	env := envMap(c.Config.Env)
	user, db := env["POSTGRES_USER"], env["POSTGRES_DB"]
	if !namePattern.MatchString(user) || !namePattern.MatchString(db) {
		return "", "", errors.New("unsupported PostgreSQL role or database name")
	}
	return user, db, nil
}
func (d *Docker) waitPostgres(ctx context.Context, id, user, db string) error {
	for i := 0; i < 90; i++ {
		// The official entrypoint starts a temporary Unix-socket-only server to
		// initialize the database. TCP becomes available after that server stops.
		if _, err := d.run(ctx, "exec", id, "pg_isready", "-h", "127.0.0.1", "-U", user, "-d", db); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return errors.New("restore probe PostgreSQL did not become ready")
}

// restoreArchive decrypts the checkpoint into one database, in one transaction.
func (d *Docker) restoreArchive(ctx context.Context, s *State, key []byte, container, user, db string) error {
	f, err := os.Open(filepath.Join(d.root, s.Backup))
	if err != nil {
		return err
	}
	defer f.Close()
	reader, writer := io.Pipe()
	result := make(chan error, 1)
	go func() { err := decryptBackup(writer, f, key); writer.CloseWithError(err); result <- err }()
	err = d.stream(ctx, reader, io.Discard, "exec", "-i", container, "pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "-U", user, "-d", db)
	reader.Close()
	decryption := <-result
	if err != nil {
		return err
	}
	return decryption
}

// Full pg_restore executes against a disposable, network-isolated database.
// The operator's database is never the restore target in this automatic path.
func (d *Docker) withRestoredCopy(ctx context.Context, s *State, key []byte, use func(probe, user, db string) error) (resultErr error) {
	user, db, err := d.dbNames(ctx, s.Database)
	if err != nil {
		return err
	}
	name := "vaultix-restore-" + s.Operation
	c, inspectErr := d.inspect(ctx, name)
	if inspectErr == nil {
		if c.Config.Labels["vaultix.lifecycle.operation"] != s.Operation || c.Config.Labels["vaultix.lifecycle.role"] != "restore-probe" || c.Image != s.DatabaseImage {
			return errors.New("restore probe name belongs to another resource")
		}
		if _, err = d.run(ctx, "rm", "-f", "-v", c.ID); err != nil {
			return err
		}
	}
	raw, err := d.run(ctx, "create", "--name", name, "--label", "vaultix.lifecycle.operation="+s.Operation, "--label", "vaultix.lifecycle.role=restore-probe", "--network", "none", "--env", "POSTGRES_USER="+user, "--env", "POSTGRES_DB="+db, "--env", "POSTGRES_HOST_AUTH_METHOD=trust", s.DatabaseImage)
	if err != nil {
		return err
	}
	c, err = d.inspect(ctx, string(raw))
	if err != nil {
		return err
	}
	if c.Config.Labels["vaultix.lifecycle.operation"] != s.Operation || c.Config.Labels["vaultix.lifecycle.role"] != "restore-probe" || c.Image != s.DatabaseImage {
		return errors.New("restore probe name belongs to another resource")
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := d.run(cleanup, "rm", "-f", "-v", c.ID); err != nil && resultErr == nil {
			resultErr = errors.New("restore probe cleanup failed; checkpoint not accepted")
		}
	}()
	if _, err = d.run(ctx, "start", c.ID); err != nil {
		return err
	}
	if err = d.waitPostgres(ctx, c.ID, user, db); err != nil {
		return err
	}
	if err = d.restoreArchive(ctx, s, key, c.ID, user, db); err != nil {
		return err
	}
	return use(c.ID, user, db)
}

func (d *Docker) restoreProbe(ctx context.Context, s *State, key []byte) error {
	return d.withRestoredCopy(ctx, s, key, func(probe, user, db string) error {
		const query = "SELECT count(*) FROM vaultix_migrations; " + secretsQuery
		original := sha256.New()
		err := d.stream(ctx, nil, original, "exec", s.Database, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At", "-c", query)
		if err != nil {
			return err
		}
		restored := sha256.New()
		err = d.stream(ctx, nil, restored, "exec", probe, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At", "-c", query)
		if err != nil {
			return err
		}
		if !bytes.Equal(original.Sum(nil), restored.Sum(nil)) {
			return errors.New("restored migration/secret checkpoint differs")
		}
		return nil
	})
}
