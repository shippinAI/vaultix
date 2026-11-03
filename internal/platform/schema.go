package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

var environmentKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Stream ciphertext rows into a bounded-memory hash, not one database-sized
// string_agg value. No decrypted values or database output reach diagnostics.
const secretsQuery = `COPY (SELECT id, encode("encryptedValue",'hex') FROM secrets_v2 ORDER BY id) TO STDOUT;`

type migrationManifest struct {
	Set   string            `json:"set"`
	Files map[string]string `json:"files"`
}

func (d *Docker) migrationManifest(ctx context.Context, image string) (migrationManifest, error) {
	var m migrationManifest
	raw, err := d.run(ctx, "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "node", image, "-e", migrationProbe)
	if err != nil {
		return m, err
	}
	if json.Unmarshal(raw, &m) != nil || !hashPattern.MatchString(m.Set) || len(m.Files) == 0 {
		return m, errors.New("cannot establish image migration identity")
	}
	for name, hash := range m.Files {
		if !migrationNamePattern.MatchString(name) || !hashPattern.MatchString(hash) {
			return m, errors.New("cannot establish image migration identity")
		}
	}
	return m, nil
}

func (d *Docker) migrations(ctx context.Context, image string) (string, error) {
	m, err := d.migrationManifest(ctx, image)
	return m.Set, err
}

func appliedDigest(applied []string) string {
	names := append([]string(nil), applied...)
	sort.Strings(names)
	return digest([]byte(strings.Join(names, "\n")))
}

// planMigration decides from image contents and the store's own record. The
// store is the authority: a prior image's files can trail what was applied.
func planMigration(prior, target migrationManifest, applied []string) (*MigrationPlan, error) {
	if prior.Set == target.Set {
		return nil, nil
	}
	shipped := make([]string, 0, len(prior.Files))
	for name := range prior.Files {
		shipped = append(shipped, name)
	}
	sort.Strings(shipped)
	for _, name := range shipped {
		if current, present := target.Files[name]; present && current != prior.Files[name] {
			return nil, fmt.Errorf("candidate changes migration %s, which already shipped; refusing to rewrite schema history", name)
		}
	}
	done := make(map[string]bool, len(applied))
	for _, name := range applied {
		if _, present := target.Files[name]; !present {
			return nil, fmt.Errorf("database has migration %s, which this candidate does not include; refusing a downgrade", name)
		}
		done[name] = true
	}
	var pending []string
	for name := range target.Files {
		if !done[name] {
			pending = append(pending, name)
		}
	}
	if len(pending) == 0 {
		return nil, nil
	}
	sort.Strings(pending)
	return &MigrationPlan{From: prior.Set, Applied: appliedDigest(applied), Pending: pending}, nil
}

// The recovery checkpoint covers one PostgreSQL database. Migrating a store it
// cannot restore, or one the rehearsal cannot reproduce, is not a recoverable plan.
func migrationTopology(env map[string]string) error {
	if env["AUDIT_LOGS_DB_CONNECTION_URI"] != "" {
		return errors.New("a separate audit log database is outside the recovery checkpoint; this configuration cannot take a changed migration set")
	}
	if env["GENERATE_SANITIZED_SCHEMA"] == "true" {
		return errors.New("GENERATE_SANITIZED_SCHEMA changes how migrations run at startup; this configuration cannot take a changed migration set")
	}
	return nil
}

// The one-off container reads its settings from a pipe through /dev/stdin.
func migrationHost(goos string) error {
	if goos == "windows" {
		return errors.New("a changed migration set needs the Linux vaultix binary on the Docker host")
	}
	return nil
}

func (d *Docker) planSchema(ctx context.Context, s *State, priorImage string, target Candidate) (*MigrationPlan, error) {
	prior, err := d.migrationManifest(ctx, priorImage)
	if err != nil {
		return nil, err
	}
	if prior.Set == target.Migrations {
		return nil, nil
	}
	if err = migrationHost(runtime.GOOS); err != nil {
		return nil, err
	}
	next, err := d.migrationManifest(ctx, target.Image)
	if err != nil {
		return nil, err
	}
	if next.Set != target.Migrations {
		return nil, errors.New("candidate migration identity changed")
	}
	env, err := d.applicationEnvironment(ctx, target.Image)
	if err != nil {
		return nil, err
	}
	if err = migrationTopology(env); err != nil {
		return nil, err
	}
	if _, err = migrationEnvironmentFile(env); err != nil {
		return nil, err
	}
	user, db, err := d.dbNames(ctx, s.Database)
	if err != nil {
		return nil, err
	}
	applied, err := d.appliedMigrations(ctx, s.Database, user, db)
	if err != nil {
		return nil, err
	}
	if err = d.migrationUnlocked(ctx, s.Database, user, db); err != nil {
		return nil, err
	}
	return planMigration(prior, next, applied)
}

func (d *Docker) psql(ctx context.Context, container, user, db, query string) ([]byte, error) {
	return d.run(ctx, "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At", "-c", query)
}

func (d *Docker) appliedMigrations(ctx context.Context, container, user, db string) ([]string, error) {
	raw, err := d.psql(ctx, container, user, db, "SELECT name FROM vaultix_migrations ORDER BY name;")
	if err != nil {
		return nil, err
	}
	return strings.Fields(string(raw)), nil
}

func (d *Docker) migrationUnlocked(ctx context.Context, container, user, db string) error {
	raw, err := d.psql(ctx, container, user, db, "SELECT count(*) FROM vaultix_migrations_lock WHERE is_locked <> 0;")
	if err != nil {
		return err
	}
	if string(raw) != "0" {
		return errors.New("the database migration lock is held; investigate before continuing")
	}
	return nil
}

func (d *Docker) secretsFingerprint(ctx context.Context, container, user, db string) (string, error) {
	h := sha256.New()
	if err := d.stream(ctx, nil, h, "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At", "-c", secretsQuery); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// A value reaches the one-off container through a pipe, so it is never in Docker
// arguments or the client's environment. An environment file cannot hold a line
// break, and silently dropping a setting would rehearse a different application.
func migrationEnvironmentFile(env map[string]string) ([]byte, error) {
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var file bytes.Buffer
	for _, key := range keys {
		if !environmentKeyPattern.MatchString(key) || strings.ContainsAny(env[key], "\r\n") {
			return nil, fmt.Errorf("setting %s cannot be passed to the migration; single-line values are required", key)
		}
		file.WriteString(key + "=" + env[key] + "\n")
	}
	return file.Bytes(), nil
}

// migrationLog keeps the tail of a run in the private instance directory. Output
// can quote migration SQL, so it stays out of results and diagnostics.
func (d *Docker) migrationLog(ctx context.Context, s *State, role, container string) {
	var out limitedOutput
	out.limit = 2 * 1024 * 1024
	_ = d.combined(ctx, &out, "logs", "--tail", "2000", container)
	path := filepath.Join(d.root, fmt.Sprintf("%s-%s-%s.log", s.Operation, role, randomHex(6)))
	_ = newFile(path, out.Bytes())
}

// applyMigrations runs the image's own migration command in a detached, named
// container. That command is identical for the rehearsal and the live store, and
// the container outlives this process so recovery can find it.
func (d *Docker) applyMigrations(ctx context.Context, s *State, role, network string, env map[string]string) error {
	name := "vaultix-" + role + "-" + s.Operation
	if c, err := d.inspect(ctx, name); err == nil {
		if c.Config.Labels["vaultix.lifecycle.operation"] != s.Operation || c.Config.Labels["vaultix.lifecycle.role"] != role {
			return errors.New("migration container name belongs to another resource")
		}
		// Killing a run in progress would strand the migration lock in the store.
		// Let it finish; the command below then finds nothing left to apply.
		if c.State.Running && role == "migrate" {
			if _, err = d.run(ctx, "wait", c.ID); err != nil {
				return err
			}
		}
		d.migrationLog(ctx, s, role, c.ID)
		if _, err = d.run(ctx, "rm", "-f", "-v", c.ID); err != nil {
			return err
		}
	}
	file, err := migrationEnvironmentFile(env)
	if err != nil {
		return err
	}
	var created limitedOutput
	created.limit = 4096
	err = d.stream(ctx, bytes.NewReader(file), &created, "create", "--pull", "never", "--name", name,
		"--label", "vaultix.lifecycle.operation="+s.Operation, "--label", "vaultix.lifecycle.role="+role,
		"--network", network, "--env-file", "/dev/stdin", "--entrypoint", "node", s.Candidate.Image,
		"node_modules/knex/bin/cli.js", "--knexfile", "./dist/db/knexfile.mjs", "--client", "pg", "migrate:latest")
	if err != nil {
		return err
	}
	id := strings.TrimSpace(created.String())
	if _, err = d.run(ctx, "start", id); err != nil {
		return err
	}
	exit, err := d.run(ctx, "wait", id)
	if err != nil {
		return err
	}
	d.migrationLog(ctx, s, role, id)
	if _, err = d.run(ctx, "rm", "-f", "-v", id); err != nil {
		return err
	}
	if string(exit) != "0" {
		return fmt.Errorf("migration command exited %s; the output is in %s-%s-*.log in the instance directory", exit, s.Operation, role)
	}
	return nil
}

// verifyMigrated reads the result back from the database rather than trusting an
// exit status. A plan that rewrites secret ciphertext needs its own reviewed path.
func (d *Docker) verifyMigrated(ctx context.Context, s *State, container, user, db string) error {
	target, err := d.migrationManifest(ctx, s.Candidate.Image)
	if err != nil {
		return err
	}
	applied, err := d.appliedMigrations(ctx, container, user, db)
	if err != nil {
		return err
	}
	if len(applied) != len(target.Files) {
		return errors.New("migrated database does not match the candidate's migration set")
	}
	for _, name := range applied {
		if _, present := target.Files[name]; !present {
			return errors.New("migrated database does not match the candidate's migration set")
		}
	}
	if err = d.migrationUnlocked(ctx, container, user, db); err != nil {
		return err
	}
	secrets, err := d.secretsFingerprint(ctx, container, user, db)
	if err != nil {
		return err
	}
	if secrets != s.Migration.Secrets {
		return errors.New("a migration changed encrypted secret rows")
	}
	return nil
}

// The copy has no network path, so real keys cannot reach anything outside it,
// and a failure here has changed nothing the live application depends on.
func (d *Docker) rehearse(ctx context.Context, s *State) error {
	key, err := privateRead(configPath(d.root, "recovery.key"), 8192)
	if err != nil {
		return errors.New("recovery key is unavailable")
	}
	env, err := d.applicationEnvironment(ctx, s.Candidate.Image)
	if err != nil {
		return err
	}
	return d.withRestoredCopy(ctx, s, key, func(probe, user, db string) error {
		defer d.discardRehearsal(s)
		applied, err := d.appliedMigrations(ctx, probe, user, db)
		if err != nil {
			return err
		}
		if appliedDigest(applied) != s.Migration.Applied {
			return errors.New("database migrations changed after this upgrade was planned")
		}
		env["DB_CONNECTION_URI"] = "postgres://" + user + "@127.0.0.1:5432/" + db
		if err = d.applyMigrations(ctx, s, "rehearsal", "container:"+probe, env); err != nil {
			return err
		}
		return d.verifyMigrated(ctx, s, probe, user, db)
	})
}

func (d *Docker) migrateLive(ctx context.Context, s *State) error {
	env, err := d.applicationEnvironment(ctx, s.Candidate.Image)
	if err != nil {
		return err
	}
	user, db, err := d.dbNames(ctx, s.Database)
	if err != nil {
		return err
	}
	if err = d.applyMigrations(ctx, s, "migrate", d.instance.Project+"_default", env); err != nil {
		return err
	}
	return d.verifyMigrated(ctx, s, s.Database, user, db)
}

func (d *Docker) priorStopped(ctx context.Context, s *State) error {
	old, err := d.inspect(ctx, s.PriorContainer)
	if err != nil || old.State.Running {
		return errors.New("old application must remain stopped during the migration")
	}
	return nil
}
