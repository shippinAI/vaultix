package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestPackagedCommandArguments(t *testing.T) {
	local := `C:\Users\Fixture User\AppData\Local`
	pkg := `C:\Program Files\WindowsApps\Vaultix.CLI_1.2.4.0_x64__fixture`
	for _, name := range []string{"vaultix.exe", "vaultixl.exe"} {
		alias := filepath.Join(local, "Microsoft", "WindowsApps", name)
		exe := filepath.Join(pkg, name)
		tail := []string{"run", "--offline", "--", "app.exe", "two words", "", alias, "--json"}
		duplicate := append([]string{alias, alias}, tail...)
		for _, tc := range []struct {
			name            string
			args            []string
			exe, pkg, local string
			correct         bool
		}{
			{"exact", duplicate, exe, pkg, local, true},
			{"case-insensitive", duplicate, strings.ToUpper(exe), strings.ToUpper(pkg), local, true},
			{"ordinary", append([]string{alias}, tail...), exe, pkg, local, false},
			{"no-package", duplicate, exe, "", local, false},
			{"no-known-folder", duplicate, exe, pkg, "", false},
			{"portable", duplicate, `C:\Tools\` + name, pkg, local, false},
			{"wrong-package", duplicate, exe, pkg + "-other", local, false},
			{"package-subdirectory", duplicate, filepath.Join(pkg, "bin", name), pkg, local, false},
			{"wrong-user", duplicate, exe, pkg, `C:\Users\Other\AppData\Local`, false},
			{"wrong-binary", duplicate, filepath.Join(pkg, "other.exe"), pkg, local, false},
			{"unrelated-prefix", []string{alias, `C:\Untrusted\vaultix.exe`, "version"}, exe, pkg, local, false},
			{"bare-prefix", []string{name, name, "version"}, exe, pkg, local, false},
			{"direct-package-path", []string{exe, exe, "version"}, exe, pkg, local, false},
			{"short", []string{alias, alias}, exe, pkg, local, false},
			{"no-command", []string{alias}, exe, pkg, local, false},
			{"different-command-name", []string{alias, filepath.Join(local, "Microsoft", "WindowsApps", "other.exe"), "version"}, exe, pkg, local, false},
		} {
			t.Run(name+"/"+tc.name, func(t *testing.T) {
				before := append([]string{}, tc.args...)
				want := tc.args[1:]
				if tc.correct {
					want = tc.args[2:]
				}
				got := packagedCommandArguments(tc.args, tc.exe, tc.pkg, tc.local)
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("got %q, want %q", got, want)
				}
				if !reflect.DeepEqual(tc.args, before) {
					t.Fatal("input arguments mutated")
				}
			})
		}
	}
}

func TestPortableCommandArguments(t *testing.T) {
	if currentPackagePath() != "" {
		t.Fatal("portable test must run outside a package")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	args := []string{exe, exe, "version", "--json"}
	if got := commandArguments(args); !reflect.DeepEqual(got, args[1:]) {
		t.Fatalf("portable arguments changed: %q", got)
	}
}
