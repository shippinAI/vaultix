package store

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestCredentialLockProcess(t *testing.T) {
	if os.Getenv("VAULTIX_LOCK_TEST_CHILD") != "1" {
		return
	}
	if ready := os.Getenv("VAULTIX_LOCK_TEST_READY"); ready != "" {
		err := WithCredentialLock(context.Background(), os.Getenv("VAULTIX_LOCK_TEST_PATH"), func() error {
			if err := os.WriteFile(ready, []byte("locked"), 0600); err != nil {
				return err
			}
			time.Sleep(time.Hour)
			return nil
		})
		if err != nil {
			os.Exit(4)
		}
		os.Exit(0)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	err := WithCredentialLock(ctx, os.Getenv("VAULTIX_LOCK_TEST_PATH"), func() error { return nil })
	if os.Getenv("VAULTIX_LOCK_TEST_EXPECT_BUSY") == "1" {
		if !errors.Is(err, context.DeadlineExceeded) {
			os.Exit(2)
		}
	} else if err != nil {
		os.Exit(3)
	}
	os.Exit(0)
}

func TestCredentialLockReleasedAfterProcessDeath(t *testing.T) {
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	path, ready := filepath.Join(dir, "credential.json"), filepath.Join(dir, "ready")
	cmd := exec.Command(os.Args[0], "-test.run=^TestCredentialLockProcess$")
	cmd.Env = append(os.Environ(), "VAULTIX_LOCK_TEST_CHILD=1", "VAULTIX_LOCK_TEST_PATH="+path, "VAULTIX_LOCK_TEST_READY="+ready)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("child did not acquire lock")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := WithCredentialLock(ctx, path, func() error { return nil }); err != nil {
		t.Fatal("dead process retained lock", err)
	}
}

func TestCredentialLockExcludesOtherProcessAndReleases(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "credential.json")
	child := func(busy string) {
		t.Helper()
		cmd := exec.Command(os.Args[0], "-test.run=^TestCredentialLockProcess$")
		cmd.Env = append(os.Environ(), "VAULTIX_LOCK_TEST_CHILD=1", "VAULTIX_LOCK_TEST_PATH="+path, "VAULTIX_LOCK_TEST_EXPECT_BUSY="+busy)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("child lock failed: %v %s", err, output)
		}
	}
	if err := WithCredentialLock(context.Background(), path, func() error { child("1"); return nil }); err != nil {
		t.Fatal(err)
	}
	child("0")
	if _, err := os.Stat(path + ".lock"); err != nil {
		t.Fatal("lock file must remain after release")
	}
}

func TestCredentialLockCancellationAndActionFailure(t *testing.T) {
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	path := filepath.Join(dir, "credential.json")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if err := WithCredentialLock(ctx, path, func() error { called = true; return nil }); !errors.Is(err, context.Canceled) || called {
		t.Fatal("canceled lock ran action")
	}
	failure := errors.New("fixture")
	if err := WithCredentialLock(context.Background(), path, func() error { return failure }); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	if err := WithCredentialLock(context.Background(), path, func() error { return nil }); err != nil {
		t.Fatal("failed action leaked lock")
	}
}

func TestCredentialLockRejectsUnsafeFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permissions and symlinks")
	}
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	path := filepath.Join(dir, "credential.json")
	check := func() {
		t.Helper()
		if WithCredentialLock(context.Background(), path, func() error { t.Error("unsafe lock accepted"); return nil }) == nil {
			t.Fatal("expected denial")
		}
	}
	if err := os.Symlink(filepath.Join(dir, "target"), path+".lock"); err != nil {
		t.Fatal(err)
	}
	check()
	os.Remove(path + ".lock")
	os.WriteFile(path+".lock", nil, 0644)
	check()
	os.Chmod(path+".lock", 0600)
	os.Chmod(dir, 0755)
	check()
	os.Chmod(dir, 0700)
}
