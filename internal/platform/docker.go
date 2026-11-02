package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
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

// No shell or operator-provided executable is used. Environment files remain on
// disk; subprocess diagnostics cannot leak their expanded secret values.
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
	cmd := exec.CommandContext(ctx, d.executable, args...)
	cmd.Dir = d.root
	cmd.Env = commandEnvironment()
	cmd.Stdin = input
	cmd.Stdout = output
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 5 * time.Second
	if cmd.Run() != nil {
		return errors.New("Docker operation failed; instance state is retained for recovery")
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
	data, _ := json.Marshal(map[string]any{"services": map[string]any{"backend": map[string]any{"image": image, "labels": label}, "db": map[string]any{"labels": label}, "cache": map[string]any{"labels": label}}})
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
	return nil
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
func (d *Docker) runtimeKeys(ctx context.Context, s *State) error {
	current, err := d.inspect(ctx, s.PriorContainer)
	if err != nil {
		return err
	}
	raw, err := d.compose(ctx, s.PriorImage, "config", "--format", "json")
	if err != nil {
		return err
	}
	var cfg struct {
		Services map[string]struct{ Environment map[string]string }
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return errors.New("cannot validate instance configuration")
	}
	actual := envMap(current.Config.Env)
	expected := cfg.Services["backend"].Environment
	for _, key := range []string{"ENCRYPTION_KEY", "AUTH_SECRET", "DB_CONNECTION_URI", "SITE_URL", "VAULTIX_CACHE_URL", "VAULTIX_CACHE_PROVIDER"} {
		if expected[key] == "" || actual[key] != expected[key] {
			return errors.New("active identity/store configuration differs from the selected configuration")
		}
	}
	if expected["SITE_URL"] != d.instance.SiteURL {
		return errors.New("site origin differs from the enrolled instance")
	}
	bindings := current.NetworkSettings.Ports["8080/tcp"]
	if len(bindings) != 1 || bindings[0].HostIp != "127.0.0.1" || bindings[0].HostPort != strconv.Itoa(d.instance.Port) || len(current.Mounts) != 0 || len(current.NetworkSettings.Networks) != 1 || current.NetworkSettings.Networks[d.instance.Project+"_default"] == nil {
		return errors.New("deployment topology differs from the supported single-instance Compose layout; retain the existing deployment owner")
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
const migrationProbe = `const fs=require('fs'),p=require('path'),crypto=require('crypto');const dir='/backend/dist/db/migrations',names=fs.readdirSync(dir).filter(n=>/\.(mjs|ts)$/.test(n)).sort();if(!names.length||names.length>10000)process.exit(1);const h=crypto.createHash('sha256');for(const n of names){const f=p.join(dir,n);if(!fs.lstatSync(f).isFile())process.exit(1);h.update(n+'\0');h.update(fs.readFileSync(f));}process.stdout.write(h.digest('hex'));`

func (d *Docker) migrations(ctx context.Context, image string) (string, error) {
	raw, err := d.run(ctx, "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "node", image, "-e", migrationProbe)
	if err != nil {
		return "", err
	}
	if !hashPattern.Match(raw) {
		return "", errors.New("cannot establish image migration identity")
	}
	return string(raw), nil
}

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
		if _, err := d.run(ctx, "exec", id, "pg_isready", "-U", user, "-d", db); err == nil {
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

// Full pg_restore executes against a disposable, network-isolated database.
// The operator's database is never the restore target in this automatic path.
func (d *Docker) restoreProbe(ctx context.Context, s *State, key []byte) (resultErr error) {
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
	f, err := os.Open(filepath.Join(d.root, s.Backup))
	if err != nil {
		return err
	}
	defer f.Close()
	reader, writer := io.Pipe()
	result := make(chan error, 1)
	go func() { err := decryptBackup(writer, f, key); writer.CloseWithError(err); result <- err }()
	err = d.stream(ctx, reader, io.Discard, "exec", "-i", c.ID, "pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "-U", user, "-d", db)
	reader.Close()
	decryption := <-result
	if err != nil {
		return err
	}
	if decryption != nil {
		return decryption
	}
	// Stream ciphertext rows into a bounded-memory hash, not one database-sized
	// string_agg value. No decrypted values or database output reach diagnostics.
	const query = `SELECT count(*) FROM vaultix_migrations; COPY (SELECT id, encode("encryptedValue",'hex') FROM secrets_v2 ORDER BY id) TO STDOUT;`
	original := sha256.New()
	err = d.stream(ctx, nil, original, "exec", s.Database, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At", "-c", query)
	if err != nil {
		return err
	}
	restored := sha256.New()
	err = d.stream(ctx, nil, restored, "exec", c.ID, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", db, "-At", "-c", query)
	if err != nil {
		return err
	}
	if !bytes.Equal(original.Sum(nil), restored.Sum(nil)) {
		return errors.New("restored migration/secret checkpoint differs")
	}
	return nil
}
