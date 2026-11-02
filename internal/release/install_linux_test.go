package release

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func installFixture(t *testing.T) (*acquisitionFixture, CLIInstallOptions) {
	t.Helper()
	f := newAcquisitionFixture(t)
	if err := os.Mkdir(f.options.Directory, 0700); err != nil {
		t.Fatal(err)
	}
	writeInstallFixture(t, f)
	return f, CLIInstallOptions{Directory: filepath.Join(filepath.Dir(f.options.Directory), "installed"), Bundle: f.options.Directory, Trust: f.options.Trust}
}
func writeInstallFixture(t *testing.T, f *acquisitionFixture) {
	t.Helper()
	f.sign(t)
	for name, data := range f.bodies {
		if err := os.WriteFile(filepath.Join(f.options.Directory, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
func acceptFixture(context.Context, string, ReleaseManifest) error { return nil }
func nowFixture(f *acquisitionFixture) func() time.Time            { return func() time.Time { return f.now } }

func TestCLIInstallationPairAndCheckpoint(t *testing.T) {
	f, o := installFixture(t)
	first, err := installCLI(context.Background(), o, nowFixture(f), acceptFixture)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Changed || first.Version != "1.2.3" || first.PreviousDirectory != "" {
		t.Fatal(first)
	}
	old, err := os.ReadFile(filepath.Join(first.BinDirectory, "accepted.json"))
	if err != nil {
		t.Fatal(err)
	}
	f.manifest.Version = "1.2.4"
	f.manifest.Sequence++
	writeInstallFixture(t, f)
	second, err := installCLI(context.Background(), o, nowFixture(f), acceptFixture)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Changed || second.Version != "1.2.4" || second.PreviousDirectory == "" {
		t.Fatal(second)
	}
	retained, err := os.ReadFile(filepath.Join(second.PreviousDirectory, "accepted.json"))
	if err != nil || string(retained) != string(old) {
		t.Fatal("previous generation not retained")
	}
	status, err := CLIInstallation(o.Directory)
	if err != nil || status.Version != "1.2.4" || status.Checkpoint != second.Checkpoint {
		t.Fatal(status, err)
	}
	noChange, err := installCLI(context.Background(), o, nowFixture(f), acceptFixture)
	if err != nil || noChange.Changed {
		t.Fatal(noChange, err)
	}
	f.manifest.Version = "1.2.3"
	f.manifest.Sequence++
	writeInstallFixture(t, f)
	if _, err = installCLI(context.Background(), o, nowFixture(f), acceptFixture); err == nil {
		t.Fatal("downgrade accepted")
	}
	// Previously accepted code remains readable after distribution expiry.
	trust, _ := os.ReadFile(o.Trust)
	if _, _, err = installedCLI(o.Directory, trust, f.now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
}

func TestCLIInstallRefusalsPreserveFiles(t *testing.T) {
	for _, test := range []string{"unowned", "symlink", "trust", "tamper", "expired", "cancel", "wrong-version", "native-format", "native-check-failure"} {
		t.Run(test, func(t *testing.T) {
			f, o := installFixture(t)
			check := acceptFixture
			ctx := context.Background()
			switch test {
			case "unowned":
				os.Mkdir(o.Directory, 0700)
				os.WriteFile(filepath.Join(o.Directory, "vaultix"), []byte("package manager owned"), 0700)
			case "symlink":
				real := filepath.Join(filepath.Dir(o.Directory), "other")
				os.Mkdir(real, 0700)
				if err := os.Symlink(real, o.Directory); err != nil {
					t.Fatal(err)
				}
			case "trust":
				os.WriteFile(o.Trust, []byte("invalid trust"), 0600)
			case "tamper":
				os.WriteFile(filepath.Join(o.Bundle, "vaultix-linux-amd64"), []byte("tamper"), 0600)
			case "expired":
				f.manifest.ExpiresAt = f.now.Add(-time.Second).Format(time.RFC3339)
				writeInstallFixture(t, f)
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				check = func(context.Context, string, ReleaseManifest) error { cancel(); return nil }
			case "wrong-version":
				o.Version = "9.9.9"
			case "native-format":
				check = checkNativeCLI
			case "native-check-failure":
				check = func(context.Context, string, ReleaseManifest) error { return errors.New("wrong executable identity") }
			}
			if _, err := installCLI(ctx, o, nowFixture(f), check); err == nil {
				t.Fatal("invalid install accepted")
			}
			if test == "unowned" {
				entries, _ := os.ReadDir(o.Directory)
				if len(entries) != 1 || entries[0].Name() != "vaultix" {
					t.Fatal("unowned directory modified")
				}
			} else if test != "symlink" {
				if _, err := os.Lstat(o.Directory); !os.IsNotExist(err) {
					t.Fatal("failed fresh install published")
				}
			}
		})
	}
}

func TestCLIInstallLockAndFailedUpdate(t *testing.T) {
	f, o := installFixture(t)
	if _, err := installCLI(context.Background(), o, nowFixture(f), acceptFixture); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(o.Directory, "current", "accepted.json"))
	f.manifest.Version = "1.2.4"
	f.manifest.Sequence++
	writeInstallFixture(t, f)
	lock, err := openInstallLock(o.Directory, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = installCLI(context.Background(), o, nowFixture(f), acceptFixture); err == nil {
		t.Fatal("concurrent lock admitted")
	}
	lock.Close()
	ctx, cancel := context.WithCancel(context.Background())
	if _, err = installCLI(ctx, o, nowFixture(f), func(context.Context, string, ReleaseManifest) error { cancel(); return nil }); err == nil {
		t.Fatal("cancelled update accepted")
	}
	after, _ := os.ReadFile(filepath.Join(o.Directory, "current", "accepted.json"))
	if string(before) != string(after) {
		t.Fatal("failed update changed accepted state")
	}
	other := newAcquisitionFixture(t)
	o.Trust = other.options.Trust
	if _, err = installCLI(context.Background(), o, nowFixture(f), acceptFixture); err == nil {
		t.Fatal("trust replacement accepted")
	}
}

func TestCLIStatusRejectsTamperedOrLinkedState(t *testing.T) {
	for _, name := range []string{"accepted.json", "release-manifest.json", "release-signature.json", "vaultix", "vaultixl"} {
		t.Run(name, func(t *testing.T) {
			f, o := installFixture(t)
			if _, err := installCLI(context.Background(), o, nowFixture(f), acceptFixture); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(o.Directory, "current", name)
			data, _ := os.ReadFile(path)
			outside := filepath.Join(filepath.Dir(o.Directory), "outside")
			os.WriteFile(outside, data, 0700)
			os.Remove(path)
			os.Symlink(outside, path)
			if _, err := CLIInstallation(o.Directory); err == nil {
				t.Fatal("linked installed state accepted")
			}
		})
	}
}
