package backups

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"shippin.cloud/vaultix/internal/platform"
	"shippin.cloud/vaultix/platform/shippin/fleet"
)

func record(t *testing.T, directory string, created time.Time) {
	t.Helper()
	name := "backup-" + created.Format("20060102T150405Z") + "-aaaaaaaa"
	dir := filepath.Join(directory, "backups")
	_ = os.MkdirAll(dir, 0o700)
	raw, _ := json.Marshal(platform.BackupRecord{Name: name, CreatedAt: created.Format(time.RFC3339), Verified: true})
	if err := os.WriteFile(filepath.Join(dir, name+".json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestOnlyOverdueInstancesAreBackedUpWithTheirProfileRetention(t *testing.T) {
	now := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	fresh, stale, never := t.TempDir(), t.TempDir(), t.TempDir()
	record(t, fresh, now.Add(-30*time.Minute))
	record(t, stale, now.Add(-2*time.Hour))
	var calls []platform.Options
	execute := func(_ context.Context, action string, o platform.Options, _ io.Writer) (platform.Result, error) {
		switch action {
		case "status":
			return platform.Result{Ready: true}, nil
		case "backup":
			calls = append(calls, o)
			if o.Directory == never {
				return platform.Result{}, errors.New("Docker exec failed")
			}
			return platform.Result{Backup: &platform.BackupRecord{Name: "backup-new"}}, nil
		}
		return platform.Result{}, errors.New("unexpected action " + action)
	}
	f, _ := fleet.Open(t.TempDir(), execute)
	for label, in := range map[string]fleet.Instance{
		"fresh": {Customer: "Fresh", Profile: "team", Directory: fresh},
		"stale": {Customer: "Stale", Profile: "team", Directory: stale},
		"never": {Customer: "Never", Profile: "starter", Directory: never},
	} {
		in.Label = label
		if _, err := f.Enroll(context.Background(), in); err != nil {
			t.Fatal(err)
		}
	}
	outcomes, err := RunDue(context.Background(), f, execute, now)
	if err != nil || len(outcomes) != 2 || len(calls) != 2 {
		t.Fatalf("outcomes %+v calls %+v err %v", outcomes, calls, err)
	}
	byLabel := map[string]Outcome{}
	for _, o := range outcomes {
		byLabel[o.Label] = o
	}
	if byLabel["stale"].Backup != "backup-new" || byLabel["never"].Error == "" {
		t.Fatalf("outcomes %+v", byLabel)
	}
	for _, c := range calls {
		want := 48
		if c.Directory == never {
			want = 7
		}
		if c.Keep != want {
			t.Fatalf("backup for %s kept %d, want %d", c.Directory, c.Keep, want)
		}
	}
	if _, found := Now(context.Background(), f, execute, "missing"); found {
		t.Fatal("an unknown label was backed up")
	}
	if o, found := Now(context.Background(), f, execute, "fresh"); !found || o.Backup == "" {
		t.Fatalf("an on-demand backup was refused: %+v", o)
	}
}
