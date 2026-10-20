package store

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestRoundTripEncrypted(t *testing.T) {
	d := t.TempDir()
	key, err := DataKey(filepath.Join(d, "key"))
	if err != nil {
		t.Fatal(err)
	}
	s := &Store{Dir: d, Key: key}
	sc := &Scope{Entries: map[string]Entry{"TOKEN": {Value: "s3cret-value", Base: 4}}, Deleted: map[string]int{}}
	if err := s.Save("p.dev_", sc); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(d, "p.dev_.vx"))
	if bytes.Contains(raw, []byte("s3cret-value")) {
		t.Fatal("value stored in clear")
	}
	if fi, _ := os.Stat(filepath.Join(d, "p.dev_.vx")); fi.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", fi.Mode().Perm())
	}
	got, err := s.Load("p.dev_")
	if err != nil || got.Entries["TOKEN"].Value != "s3cret-value" || got.Entries["TOKEN"].Base != 4 {
		t.Fatalf("%v %+v", err, got)
	}
	bad := &Store{Dir: d, Key: make([]byte, 32)}
	if _, err := bad.Load("p.dev_"); err == nil {
		t.Fatal("wrong key must fail")
	}
}

func TestKeyFileMustBePrivate(t *testing.T) {
	p := filepath.Join(t.TempDir(), "key")
	if _, err := DataKey(p); err != nil {
		t.Fatal(err)
	}
	os.Chmod(p, 0o644)
	if _, err := DataKey(p); err == nil {
		t.Fatal("0644 key file accepted")
	}
}
