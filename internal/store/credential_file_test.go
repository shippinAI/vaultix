package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPrivateCredentialFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "credential")
	if runtime.GOOS == "windows" {
		if _, err := CredentialFile(path, "fixture"); err == nil {
			t.Fatal("POSIX permissions trusted on Windows")
		}
		return
	}
	os.Chmod(dir, 0700)
	if _, err := CredentialFile(path, "fixture"); err != nil {
		t.Fatal(err)
	}
	if value, err := CredentialFile(path, ""); err != nil || value != "fixture" {
		t.Fatal("credential read failed")
	}
	if _, err := CredentialFile(path, "replacement"); err != nil {
		t.Fatal(err)
	}
	if _, err := CredentialFile(path, strings.Repeat("x", 65537)); err == nil {
		t.Fatal("oversized credential saved")
	}
	if value, err := CredentialFile(path, ""); err != nil || value != "replacement" {
		t.Fatal("failed save changed credential")
	}
	if _, err := CredentialFile(path, strings.Repeat("x", 65536)); err == nil {
		t.Fatal("newline not included in size limit")
	}
	limit := strings.Repeat("x", 65535)
	if _, err := CredentialFile(path, limit); err != nil {
		t.Fatal(err)
	}
	if value, err := CredentialFile(path, ""); err != nil || value != limit {
		t.Fatal("maximum credential failed to round trip")
	}
	os.Chmod(path, 0644)
	if _, err := CredentialFile(path, ""); err == nil {
		t.Fatal("read public credential")
	}
	if _, err := CredentialFile(path, "overwrite"); err == nil {
		t.Fatal("overwrote public credential")
	}
	os.Chmod(path, 0600)
	if err := ForgetCredentialFile(path); err != nil {
		t.Fatal(err)
	}
	os.Symlink(filepath.Join(dir, "target"), path)
	if _, err := CredentialFile(path, "fixture"); err == nil {
		t.Fatal("followed symlink")
	}
}
