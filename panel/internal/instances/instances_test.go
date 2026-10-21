package instances

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingIsSelf(t *testing.T) {
	reg, err := Load(filepath.Join(t.TempDir(), "no-such.json"))
	if err != nil {
		t.Fatal(err)
	}
	it, ok := reg.Primary()
	if !ok || it.ID != "vaultix" || it.URL != "self" {
		t.Fatalf("want self vaultix instance, got %+v", it)
	}
}

func TestLoadEmptyPathIsSelf(t *testing.T) {
	reg, err := Load("")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := reg.Get("vaultix"); !ok {
		t.Fatal("missing default vaultix")
	}
}

func TestLoadFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "instances.json")
	if err := os.WriteFile(p, []byte(`[{"id":"a","name":"A","host":"h","url":"self"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	reg, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	it, ok := reg.Primary()
	if !ok || it.ID != "a" {
		t.Fatalf("%+v", it)
	}
}
