package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
)

// Backups of a running instance (docs/0109, Backups; docs/0125 backups domain). The same sealed
// form as an upgrade checkpoint: an age-encrypted pg_dump and the age-encrypted environment, both
// under the instance's recovery key, never its application keys. Each backup is restored into a
// disposable, network-isolated database before it counts. Because the live instance keeps taking
// writes, the restored copy must match the live migration set and have a readable secrets table;
// its ciphertext fingerprint is recorded so a later restore can be checked against it.

const backupDirectory = "backups"

var backupNamePattern = regexp.MustCompile(`^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$`)

type BackupRecord struct {
	Name            string `json:"name"`
	CreatedAt       string `json:"createdAt"`
	Image           string `json:"image,omitempty"`
	DatabaseHash    string `json:"databaseHash"`
	EnvironmentHash string `json:"environmentHash"`
	Migrations      int    `json:"migrations"`
	Secrets         string `json:"secrets"`
	Verified        bool   `json:"verified"`
}

// sealStore writes the encrypted dump to name and the encrypted environment to name+".environment",
// both relative to the instance root, and returns their digests.
func (d *Docker) sealStore(ctx context.Context, key []byte, container, user, db, name string) (string, string, error) {
	path := filepath.Join(d.root, name)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", "", err
	}
	reader, writer := io.Pipe()
	result := make(chan error, 1)
	go func() {
		err := d.stream(ctx, nil, writer, "exec", container, "pg_dump", "-U", user, "-d", db, "--format=custom", "--no-owner", "--no-acl")
		writer.CloseWithError(err)
		result <- err
	}()
	err = encryptBackup(file, reader, key)
	reader.Close()
	if dumpErr := <-result; err == nil {
		err = dumpErr
	}
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", "", err
	}
	databaseHash, err := fileDigest(path)
	if err != nil {
		return "", "", err
	}
	env, err := privateRead(configPath(d.root, "vaultix.env"), 1024*1024)
	if err != nil {
		return "", "", err
	}
	var sealed bytes.Buffer
	if err = encryptBackup(&sealed, bytes.NewReader(env), key); err != nil {
		return "", "", err
	}
	if err = newFile(path+".environment", sealed.Bytes()); err != nil {
		return "", "", err
	}
	return databaseHash, digest(sealed.Bytes()), nil
}

func backupFiles(root, name string) []string {
	base := filepath.Join(root, backupDirectory, name)
	return []string{base + ".database.age", base + ".database.age.environment", base + ".json"}
}

func instanceBackup(ctx context.Context, d *Docker, root string, s *State, keep int) (*BackupRecord, error) {
	key, err := privateRead(configPath(root, "recovery.key"), 8192)
	if err != nil {
		return nil, errors.New("recovery key is unavailable")
	}
	live, err := d.service(ctx, "db")
	if err != nil || live == nil {
		return nil, errors.New("the instance database is not running")
	}
	user, db, err := d.dbNames(ctx, live.ID)
	if err != nil {
		return nil, err
	}
	if err = os.Mkdir(filepath.Join(root, backupDirectory), 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	now := time.Now().UTC()
	record := &BackupRecord{Name: "backup-" + now.Format("20060102T150405Z") + "-" + randomHex(4), CreatedAt: now.Format(time.RFC3339), Image: s.Candidate.Image}
	files := backupFiles(root, record.Name)
	keepFiles := false
	defer func() {
		if !keepFiles {
			for _, f := range files {
				_ = os.Remove(f)
			}
		}
	}()
	dump := filepath.Join(backupDirectory, record.Name+".database.age")
	if record.DatabaseHash, record.EnvironmentHash, err = d.sealStore(ctx, key, live.ID, user, db, dump); err != nil {
		return nil, err
	}
	migrations, err := d.appliedMigrations(ctx, live.ID, user, db)
	if err != nil {
		return nil, err
	}
	probe := &State{Operation: record.Name, Backup: dump, Database: live.ID, DatabaseImage: live.Image}
	err = d.withRestoredCopy(ctx, probe, key, func(copyID, user, db string) error {
		restored, err := d.appliedMigrations(ctx, copyID, user, db)
		if err != nil {
			return err
		}
		if !slices.Equal(restored, migrations) {
			return errors.New("the restored copy has a different migration set")
		}
		record.Secrets, err = d.secretsFingerprint(ctx, copyID, user, db)
		return err
	})
	if err != nil {
		return nil, errors.New("backup did not restore cleanly and was discarded: " + err.Error())
	}
	record.Migrations, record.Verified = len(migrations), true
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return nil, err
	}
	if err = newFile(files[2], append(raw, '\n')); err != nil {
		return nil, err
	}
	keepFiles = true
	return record, pruneBackups(root, keep)
}

// Backups lists the verified backups of an instance directory, newest first. It reads only the
// records; it needs no Docker and opens no sealed file.
func Backups(directory string) ([]BackupRecord, error) {
	entries, err := os.ReadDir(filepath.Join(directory, backupDirectory))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []BackupRecord
	for _, entry := range entries {
		name, ok := strings.CutSuffix(entry.Name(), ".json")
		if !ok || !backupNamePattern.MatchString(name) || !entry.Type().IsRegular() {
			continue
		}
		raw, err := privateRead(filepath.Join(directory, backupDirectory, entry.Name()), 65536)
		if err != nil {
			return nil, err
		}
		var r BackupRecord
		if err = json.Unmarshal(raw, &r); err != nil || r.Name != name || !r.Verified {
			continue
		}
		out = append(out, r)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].CreatedAt > out[b].CreatedAt })
	return out, nil
}

// pruneBackups removes the oldest verified backups beyond keep. Only files this command made are
// touched; upgrade checkpoints live elsewhere and are never pruned here. keep 0 keeps everything.
func pruneBackups(root string, keep int) error {
	if keep <= 0 {
		return nil
	}
	records, err := Backups(root)
	if err != nil || len(records) <= keep {
		return err
	}
	for _, r := range records[keep:] {
		// The record goes last, so an interrupted prune leaves a listed backup, never a dangling one.
		files := backupFiles(root, r.Name)
		for _, f := range files {
			if err := os.Remove(f); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}
