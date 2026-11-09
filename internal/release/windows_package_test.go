package release

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsPackageSequenceAndLayout(t *testing.T) {
	for sequence, expected := range map[int64]string{1: "0.0.0.1", 65536: "0.0.1.0", 4294967296: "0.1.0.0", 281474976710656: "1.0.0.0", 9007199254740991: "31.65535.65535.65535"} {
		if got := windowsPackageVersion(sequence); got != expected {
			t.Fatalf("sequence %d: %s", sequence, got)
		}
	}
	raw := packageManifest("CN=Vaultix Test & Fixture", 65536)
	if publisher, err := validatePackageManifest(raw, 65536); err != nil || publisher != "CN=Vaultix Test & Fixture" {
		t.Fatal(publisher, err)
	}
	if _, err := validatePackageManifest(raw, 65537); err == nil {
		t.Fatal("wrong sequence accepted")
	}
	changes := map[string][2]string{
		"other-brand":               {"Name=\"Vaultix.CLI\"", "Name=\"Other.CLI\""},
		"extra-command":             {"Alias=\"vaultix.exe\"", "Alias=\"other.exe\""},
		"wrapper":                   {"Executable=\"vaultix.exe\"", "Executable=\"launcher.exe\""},
		"force-update":              {">defer<", ">allow<"},
		"credential-virtualization": {"$(KnownFolder:RoamingAppData)\\vaultix", "$(KnownFolder:RoamingAppData)\\elsewhere"},
		"extra-privilege":           {"<Capabilities>", "<Capabilities><rescap:Capability Name=\"broadFileSystemAccess\"/>"},
		"duplicate-attribute":       {"Name=\"Vaultix.CLI\"", "Name=\"Vaultix.CLI\" Name=\"Vaultix.CLI\""},
		"untrusted-namespace":       {"http://schemas.microsoft.com/appx/manifest/uap/windows10/5", "https://attacker.invalid/namespace"},
		"extra-app":                 {"</Applications>", "<Application Id=\"Extra\" Executable=\"extra.exe\"/></Applications>"},
	}
	for name, replacement := range changes {
		t.Run(name, func(t *testing.T) {
			corrupt := strings.Replace(string(raw), replacement[0], replacement[1], 1)
			if corrupt == string(raw) {
				t.Fatal("fixture did not change")
			}
			if _, err := validatePackageManifest([]byte(corrupt), 65536); err == nil {
				t.Fatal("unexpected manifest accepted")
			}
		})
	}
}

func TestWindowsPackageContents(t *testing.T) {
	// Public synthetic ZIP fixture proves validation, not deployability. The
	// system fixture must exercise signed MSIX and actual native executables.
	makeFixture := func(change func(map[string][]byte)) (string, ReleaseManifest) {
		files := map[string][]byte{"AppxManifest.xml": packageManifest("CN=Fixture", 1), "vaultix.exe": []byte("same compiled fixture"), "vaultixl.exe": []byte("same compiled fixture"), "Vaultix.png": []byte("fixture art"), "[Content_Types].xml": []byte("fixture"), "AppxBlockMap.xml": []byte("fixture"), "AppxSignature.p7x": []byte("fixture")}
		m := ReleaseManifest{SchemaVersion: "vaultix.release-manifest.v2", Sequence: 1}
		for _, name := range []string{"vaultix", "vaultixl"} {
			b := files[name+".exe"]
			m.Artifacts = append(m.Artifacts, ReleaseArtifact{Name: name + "-windows-amd64.exe", Kind: "cli", Platform: "windows/amd64", Bytes: int64(len(b)), SHA256: hashBytes(b)})
		}
		change(files)
		var buf bytes.Buffer
		z := zip.NewWriter(&buf)
		for name, b := range files {
			f, err := z.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.Write(b); err != nil {
				t.Fatal(err)
			}
		}
		if err := z.Close(); err != nil {
			t.Fatal(err)
		}
		m.Artifacts = append(m.Artifacts, ReleaseArtifact{Name: "vaultix-cli-windows-amd64.msix", Kind: "cli-package", Platform: "windows/amd64", Bytes: int64(buf.Len()), SHA256: hashBytes(buf.Bytes())})
		path := filepath.Join(t.TempDir(), "package.msix")
		if err := os.WriteFile(path, buf.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
		return path, m
	}
	path, m := makeFixture(func(map[string][]byte) {})
	if publisher, err := validateWindowsPackage(path, m); err != nil || publisher != "CN=Fixture" {
		t.Fatal(publisher, err)
	}
	for name, change := range map[string]func(map[string][]byte){
		"extra-executable":       func(f map[string][]byte) { f["extra.exe"] = []byte("evil") },
		"path-traversal":         func(f map[string][]byte) { f["../vaultix.exe"] = []byte("evil") },
		"missing-signature":      func(f map[string][]byte) { delete(f, "AppxSignature.p7x") },
		"different-native-bytes": func(f map[string][]byte) { f["vaultixl.exe"] = []byte("different") },
		"wrong-version":          func(f map[string][]byte) { f["AppxManifest.xml"] = packageManifest("CN=Fixture", 2) },
		"case-collision":         func(f map[string][]byte) { f["Vaultix.exe"] = f["vaultix.exe"] },
	} {
		t.Run(name, func(t *testing.T) {
			p, m := makeFixture(change)
			if _, err := validateWindowsPackage(p, m); err == nil {
				t.Fatal("invalid package accepted")
			}
		})
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	b[len(b)/2] ^= 0xff
	if err = os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = validateWindowsPackage(path, m); err == nil {
		t.Fatal("tampered package accepted")
	}
}
