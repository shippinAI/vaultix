package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"filippo.io/age"
)

func fixtureState() State {
	return State{Operation: "op-test", Action: "install", Configuration: strings.Repeat("a", 64), Candidate: Candidate{Image: "sha256:" + strings.Repeat("b", 64), Revision: strings.Repeat("c", 40), Migrations: strings.Repeat("d", 64), Evidence: strings.Repeat("e", 64), Trust: "local-build"}}
}
func privateTemp(t *testing.T) string {
	t.Helper()
	p := t.TempDir()
	if err := os.Chmod(p, 0700); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestBackupInteroperatesWithAge(t *testing.T) {
	key, err := newRecoveryKey()
	if err != nil {
		t.Fatal(err)
	}
	plain := bytes.Repeat([]byte("public-canary"), 20000)
	var sealed bytes.Buffer
	if err = encryptBackup(&sealed, bytes.NewReader(plain), key); err != nil {
		t.Fatal(err)
	}
	identity, err := age.ParseHybridIdentity(strings.TrimSpace(string(key)))
	if err != nil {
		t.Fatal(err)
	}
	reader, err := age.Decrypt(bytes.NewReader(sealed.Bytes()), identity)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(actual, plain) {
		t.Fatal("standard age consumer could not recover checkpoint")
	}
	var second bytes.Buffer
	writer, err := age.Encrypt(&second, identity.Recipient())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = writer.Write(plain)
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	var recovered bytes.Buffer
	if err = decryptBackup(&recovered, bytes.NewReader(second.Bytes()), key); err != nil || !bytes.Equal(recovered.Bytes(), plain) {
		t.Fatal("could not read standard age output")
	}
	if bytes.Contains(sealed.Bytes(), plain[:100]) || bytes.Equal(sealed.Bytes(), second.Bytes()) {
		t.Fatal("plaintext or deterministic backup encryption")
	}
}

func TestBackupRejectsTamperingTruncationAndWrongKey(t *testing.T) {
	key, _ := newRecoveryKey()
	var original bytes.Buffer
	if err := encryptBackup(&original, bytes.NewReader(bytes.Repeat([]byte{99}, 65536+30)), key); err != nil {
		t.Fatal(err)
	}
	raw := original.Bytes()
	for _, cut := range []int{0, 1, 24, 64, len(raw) - 1, len(raw) - 20} {
		if decryptBackup(io.Discard, bytes.NewReader(raw[:cut]), key) == nil {
			t.Fatalf("accepted truncation %d", cut)
		}
	}
	for _, offset := range []int{0, 35, 70, len(raw) - 1} {
		changed := append([]byte(nil), raw...)
		changed[offset] ^= 1
		if decryptBackup(io.Discard, bytes.NewReader(changed), key) == nil {
			t.Fatal("accepted tampering")
		}
	}
	if decryptBackup(io.Discard, bytes.NewReader(append(append([]byte(nil), raw...), 0)), key) == nil {
		t.Fatal("accepted trailing byte")
	}
	if decryptBackup(io.Discard, bytes.NewReader(raw), func() []byte { key, _ := newRecoveryKey(); return key }()) == nil {
		t.Fatal("accepted wrong key")
	}
	if err := decryptBackup(io.Discard, bytes.NewReader(raw), key); err != nil {
		t.Fatal(err)
	}
}

func TestJournalSequenceChainAndInterruptedFile(t *testing.T) {
	root := privateTemp(t)
	s := fixtureState()
	if err := saveState(root, &s, "planned"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".pending-interrupted"), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := saveState(root, &s, "dependencies"); err != nil {
		t.Fatal(err)
	}
	last, err := loadState(root)
	if err != nil || last.Sequence != 2 || last.Phase != "dependencies" {
		t.Fatal("could not resume immutable journal")
	}
	raw, err := os.ReadFile(filepath.Join(root, "event-00000001.json"))
	if err != nil {
		t.Fatal(err)
	}
	changed := bytes.Replace(raw, []byte("op-test"), []byte("op-evil"), 1)
	_ = os.WriteFile(filepath.Join(root, "event-00000001.json"), changed, 0600)
	if _, err = loadState(root); err == nil {
		t.Fatal("accepted altered journal history")
	}
}

func TestConfigurationPublicationAndNoKeyRegeneration(t *testing.T) {
	root := privateTemp(t)
	i := Instance{SchemaVersion: Schema, ID: "instance-test", Project: "vaultix-test", SiteURL: "https://test.example", Port: 8200, Daemon: "fixture"}
	if err := initialize(root, i, "", false); err != nil {
		t.Fatal(err)
	}
	env, err := privateRead(configPath(root, "vaultix.env"), 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ENCRYPTION_KEY", "AUTH_SECRET", "POSTGRES_PASSWORD"} {
		var found bool
		for _, line := range strings.Split(string(env), "\n") {
			if strings.HasPrefix(line, name+"=") {
				found = len(strings.TrimSpace(strings.TrimPrefix(line, name+"="))) >= 32
			}
		}
		if !found {
			t.Fatal("missing generated credential")
		}
	}
	before, err := configuration(root)
	if err != nil {
		t.Fatal(err)
	}
	if initialize(root, i, "", false) == nil {
		t.Fatal("reinitialized existing instance")
	}
	after, _ := configuration(root)
	if before != after {
		t.Fatal("replaced instance keys")
	}
	key, err := privateRead(configPath(root, "recovery.key"), 8192)
	if err != nil || !strings.HasPrefix(string(key), "AGE-SECRET-KEY-PQ-1") || bytes.Contains(env, key) {
		t.Fatal("recovery key not separate")
	}
}

func TestPartialInitializationDoesNotPublishConfiguration(t *testing.T) {
	root := privateTemp(t)
	stage, err := os.MkdirTemp(root, ".configuration-")
	if err != nil {
		t.Fatal(err)
	}
	_ = newFile(filepath.Join(stage, "vaultix.env"), []byte("UNUSED=fixture"))
	if _, err = privateRead(configPath(root, "instance.json"), 65536); !os.IsNotExist(err) {
		t.Fatal("partial initialization was visible")
	}
	if err = initialize(root, Instance{SchemaVersion: Schema, ID: "instance-test", Project: "test", SiteURL: "https://test.example", Port: 8200, Daemon: "fixture"}, "", false); err != nil {
		t.Fatal(err)
	}
}

func TestConfigurationDriftAndCheckpointMutation(t *testing.T) {
	root := privateTemp(t)
	_ = initialize(root, Instance{SchemaVersion: Schema, Project: "test", SiteURL: "https://test.example"}, "", false)
	s := fixtureState()
	s.Configuration, _ = configuration(root)
	s.Backup = "op-test-a.database.age"
	_ = newFile(filepath.Join(root, s.Backup), []byte("encrypted-fixture"))
	_ = newFile(filepath.Join(root, s.Backup+".environment"), []byte("encrypted-env"))
	s.BackupHash, _ = fileDigest(filepath.Join(root, s.Backup))
	s.EnvironmentHash, _ = fileDigest(filepath.Join(root, s.Backup+".environment"))
	if err := checkBackup(root, &s); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(root, s.Backup), []byte("changed"), 0600)
	if checkBackup(root, &s) == nil {
		t.Fatal("accepted changed checkpoint")
	}
	f, _ := os.OpenFile(configPath(root, "vaultix.env"), os.O_APPEND|os.O_WRONLY, 0600)
	_, _ = f.WriteString("\nCHANGED=true\n")
	f.Close()
	if runOperation(context.Background(), &Docker{root: root}, &s, io.Discard) == nil {
		t.Fatal("configuration drift accepted")
	}
}

func TestProcessEnvironmentDoesNotCarryVaultCredentials(t *testing.T) {
	t.Setenv("VAULTIX_TOKEN", "fixture-private")
	t.Setenv("POSTGRES_PASSWORD", "fixture-private")
	t.Setenv("COMPOSE_FILE", "untrusted.yml")
	t.Setenv("ENCRYPTION_KEY", "fixture-private")
	for _, entry := range commandEnvironment() {
		if strings.Contains(entry, "fixture-private") || strings.HasPrefix(entry, "COMPOSE_FILE=") {
			t.Fatal("ambient secret or Compose override propagated")
		}
	}
}

func TestReceiptDenialsBeforeDocker(t *testing.T) {
	for _, input := range []string{`{}`, `{"passed":true,"fixtures":true}`, `{"passed":false}`, `{"passed":true,"revision":"bad","imageId":"sha256:bad"}`} {
		root := privateTemp(t)
		path := filepath.Join(root, "receipt.json")
		_ = os.WriteFile(path, []byte(input), 0600)
		if _, err := candidate(context.Background(), &Docker{}, Options{BuildReceipt: path}, nil); err == nil {
			t.Fatal("invalid receipt accepted")
		}
	}
}

func TestOSLockAcrossProcessAndDeath(t *testing.T) {
	if os.Getenv("VAULTIX_LOCK_TEST_CHILD") == "1" {
		f, err := os.OpenFile(os.Getenv("VAULTIX_LOCK_TEST_PATH"), os.O_RDWR, 0600)
		if err != nil {
			os.Exit(4)
		}
		defer f.Close()
		if lockFile(f) != nil {
			os.Exit(7)
		}
		os.Exit(0)
	}
	root := privateTemp(t)
	path := filepath.Join(root, "operation.lock")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err = lockFile(f); err != nil {
		t.Fatal(err)
	}
	run := func() int {
		cmd := exec.Command(os.Args[0], "-test.run=^TestOSLockAcrossProcessAndDeath$")
		cmd.Env = append(os.Environ(), "VAULTIX_LOCK_TEST_CHILD=1", "VAULTIX_LOCK_TEST_PATH="+path)
		err := cmd.Run()
		if e, ok := err.(*exec.ExitError); ok {
			return e.ExitCode()
		}
		if err != nil {
			t.Fatal(err)
		}
		return 0
	}
	if run() != 7 {
		t.Fatal("competing process obtained lock")
	}
	unlockFile(f)
	if run() != 0 || run() != 0 {
		t.Fatal("OS did not release lock after child exit")
	}
}

func TestUnknownStateAndRecordFieldsRejected(t *testing.T) {
	s := fixtureState()
	s.Sequence = 1
	s.SchemaVersion = Schema
	s.Phase = "planned"
	raw, _ := json.Marshal(s)
	raw = append(raw[:len(raw)-1], []byte(`,"execute":"shell"}`)...)
	var target State
	if decode(raw, &target) == nil {
		t.Fatal("unknown field accepted")
	}
	s.Phase = "pretend-success"
	if s.validate() == nil {
		t.Fatal("unknown phase accepted")
	}
}

func TestPreserveCompleteIdentityAndCacheConfiguration(t *testing.T) {
	base := map[string]string{"ENCRYPTION_KEY": "fixture-key", "AUTH_SECRET": "fixture-auth", "DB_CONNECTION_URI": "fixture-store", "SITE_URL": "https://test.example", "GOOGLE_CLIENT_SECRET": "fixture-provider"}
	for _, topology := range []map[string]string{
		{"VAULTIX_CACHE_PROVIDER": "dragonfly", "VAULTIX_CACHE_URL": "redis://cache:6379"},
		{"VAULTIX_CACHE_PROVIDER": "redis", "VAULTIX_CACHE_SENTINEL_HOSTS": "sentinel:26379", "VAULTIX_CACHE_SENTINEL_MASTER_NAME": "primary"},
		{"VAULTIX_CACHE_PROVIDER": "elasticache", "VAULTIX_CACHE_CLUSTER_HOSTS": "cluster.example:6379", "VAULTIX_CACHE_TLS": "true", "VAULTIX_CACHE_URL": ""},
	} {
		expected, actual := map[string]string{}, map[string]string{}
		for key, value := range base {
			expected[key] = value
			actual[key] = value
		}
		for key, value := range topology {
			expected[key] = value
			actual[key] = value
		}
		actual["PATH"] = "/image/bin"
		expected["VAULTIX_PORT"] = "8200"
		defaults := map[string]string{"PATH": "/image/bin"}
		if err := preserveEnvironment(expected, actual, defaults); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"GOOGLE_CLIENT_SECRET", "VAULTIX_CACHE_PROVIDER"} {
			original := expected[key]
			delete(expected, key)
			if preserveEnvironment(expected, actual, defaults) == nil {
				t.Fatal("accepted lost operator setting")
			}
			expected[key] = original
		}
		actual["PATH"] = "/operator/bin"
		if preserveEnvironment(expected, actual, defaults) == nil {
			t.Fatal("discarded operator override as image default")
		}
	}
}
