package store

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestRoundTripEncrypted(t *testing.T) {
	d := t.TempDir()
	keyring.MockInit()
	key, err := DataKey("")
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
	t.Run("POSIXFileMode", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("Windows mode bits do not establish ACLs; this assertion runs on Linux")
		}
		if fi, err := os.Stat(filepath.Join(d, "p.dev_.vx")); err != nil {
			t.Fatal(err)
		} else if fi.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v", fi.Mode().Perm())
		}
	})
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
	if runtime.GOOS == "windows" {
		if _, err := DataKey(p); err == nil {
			t.Fatal("unsupported data-key file accepted")
		}
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatal("unsupported data-key fallback wrote a key before rejecting it")
		}
		return
	}
	if _, err := DataKey(p); err != nil {
		t.Fatal(err)
	}
	os.Chmod(p, 0o644)
	if _, err := DataKey(p); err == nil {
		t.Fatal("0644 key file accepted")
	}
}
