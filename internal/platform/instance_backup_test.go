package platform

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeBackup(t *testing.T, root, name, created string, verified bool) {
	t.Helper()
	dir := filepath.Join(root, backupDirectory)
	_ = os.MkdirAll(dir, 0700)
	files := backupFiles(root, name)
	for _, f := range files[:2] {
		if err := os.WriteFile(f, []byte("sealed"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(BackupRecord{Name: name, CreatedAt: created, Verified: verified})
	if err := os.WriteFile(files[2], raw, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestBackupsListsVerifiedNewestFirstAndPrunesOnlyItsOwn(t *testing.T) {
	root := privateTemp(t)
	writeBackup(t, root, "backup-20261101T000000Z-aaaaaaaa", "2026-11-01T00:00:00Z", true)
	writeBackup(t, root, "backup-20261102T000000Z-bbbbbbbb", "2026-11-02T00:00:00Z", true)
	writeBackup(t, root, "backup-20261103T000000Z-cccccccc", "2026-11-03T00:00:00Z", true)
	writeBackup(t, root, "backup-20261104T000000Z-dddddddd", "2026-11-04T00:00:00Z", false)
	checkpoint := filepath.Join(root, backupDirectory, "op-123-abcdef.database.age")
	_ = os.WriteFile(checkpoint, []byte("upgrade checkpoint"), 0600)

	records, err := Backups(root)
	if err != nil || len(records) != 3 || records[0].Name != "backup-20261103T000000Z-cccccccc" {
		t.Fatalf("records = %+v, %v", records, err)
	}
	if err = pruneBackups(root, 2); err != nil {
		t.Fatal(err)
	}
	records, _ = Backups(root)
	if len(records) != 2 || records[1].Name != "backup-20261102T000000Z-bbbbbbbb" {
		t.Fatalf("after prune = %+v", records)
	}
	for _, f := range backupFiles(root, "backup-20261101T000000Z-aaaaaaaa") {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Fatalf("%s survived the prune", f)
		}
	}
	if _, err := os.Stat(checkpoint); err != nil {
		t.Fatal("pruning touched a file it did not make")
	}
	if records, _ := Backups(privateTemp(t)); len(records) != 0 {
		t.Fatal("an instance with no backups lists some")
	}
}

func TestBackupArgumentsAreRefusedBeforeDocker(t *testing.T) {
	dir := privateTemp(t)
	for _, c := range []struct {
		action string
		o      Options
	}{
		{"status", Options{Keep: 3}},
		{"backup", Options{Keep: -1}},
		{"backup", Options{BuildReceipt: "receipt.json"}},
		{"backup", Options{Plan: true}},
	} {
		c.o.Directory = dir
		if _, err := Execute(context.Background(), c.action, c.o, io.Discard); err == nil || !strings.Contains(err.Error(), "do not belong") {
			t.Fatalf("%s %+v: got %v", c.action, c.o, err)
		}
	}
}
