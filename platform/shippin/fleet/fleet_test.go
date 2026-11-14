package fleet

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"shippin.cloud/vaultix/internal/platform"
)

func fake(managed map[string]platform.Result) Executor {
	return func(_ context.Context, action string, o platform.Options, _ io.Writer) (platform.Result, error) {
		if action != "status" {
			return platform.Result{}, errors.New("the fleet only reads status")
		}
		r, ok := managed[o.Directory]
		if !ok {
			return r, errors.New("instance not enrolled")
		}
		return r, nil
	}
}

func TestEnrollRecordsOnlyManagedInstancesAndHealthHidesCodes(t *testing.T) {
	control := t.TempDir()
	directory := filepath.Join(t.TempDir(), "acme")
	managed := map[string]platform.Result{directory: {
		Instance:  platform.Instance{SiteURL: "https://acme.vaultix.cloud"},
		Operation: &platform.State{Phase: "ready", Candidate: platform.Candidate{Image: "sha256:" + strings.Repeat("a", 64)}},
		Ready:     true,
		SetupCode: "vxs-should-never-leave", SetupURL: "https://acme.vaultix.cloud/admin/signup",
	}}
	f, err := Open(control, fake(managed))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Enroll(context.Background(), Instance{Label: "acme", Customer: "Acme", Profile: "team", Directory: directory}); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []Instance{
		{Label: "acme", Customer: "Again", Profile: "team", Directory: directory},
		{Label: "other", Customer: "Other", Profile: "team", Directory: directory},
		{Label: "Bad_Label", Customer: "X", Profile: "team", Directory: directory},
		{Label: "free", Customer: "X", Profile: "enterprise", Directory: directory},
		{Label: "ghost", Customer: "X", Profile: "team", Directory: filepath.Join(t.TempDir(), "none")},
	} {
		if _, err = f.Enroll(context.Background(), bad); err == nil {
			t.Fatalf("enrolled %+v", bad)
		}
	}
	health, err := f.Health(context.Background())
	if err != nil || len(health) != 1 || !health[0].Ready || health[0].Phase != "ready" || health[0].SiteURL != "https://acme.vaultix.cloud" {
		t.Fatalf("health = %+v, %v", health, err)
	}
	raw, _ := json.Marshal(health)
	stored, _ := os.ReadFile(filepath.Join(control, "fleet.json"))
	if strings.Contains(string(raw)+string(stored), "vxs-") {
		t.Fatal("a setup code reached the fleet")
	}
	if info, _ := os.Stat(filepath.Join(control, "fleet.json")); info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Fatal("the fleet record is readable by others")
	}
}

func TestHealthReportsAnUnreachableInstanceWithoutFailingTheFleet(t *testing.T) {
	control, directory := t.TempDir(), t.TempDir()
	managed := map[string]platform.Result{directory: {Ready: true}}
	f, _ := Open(control, fake(managed))
	if _, err := f.Enroll(context.Background(), Instance{Label: "gone", Customer: "Gone", Profile: "starter", Directory: directory}); err != nil {
		t.Fatal(err)
	}
	delete(managed, directory)
	health, err := f.Health(context.Background())
	if err != nil || len(health) != 1 || health[0].Ready || health[0].Error == "" {
		t.Fatalf("health = %+v, %v", health, err)
	}
}
