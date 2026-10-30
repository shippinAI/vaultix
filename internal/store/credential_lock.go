package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// WithCredentialLock serializes saved login/logout/rotation across CLI and MCP
// processes. The OS releases the lock on process death. Never unlink this file:
// a waiter could hold the old inode while another process locks a replacement.
// Keyring storage is per OS user, so its lock must not depend on VAULTIX_HOME.
func WithCredentialLock(ctx context.Context, credentialFile string, action func() error) error {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	path := credentialFile + ".lock"
	if credentialFile == "" {
		dir, err := os.UserConfigDir()
		if err != nil {
			return errors.New("credential lock: user configuration directory unavailable")
		}
		dir = filepath.Join(dir, "vaultix")
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		path = filepath.Join(dir, "credential.lock")
	}
	parent, err := os.Lstat(filepath.Dir(path))
	if err != nil || !parent.IsDir() || runtime.GOOS != "windows" && parent.Mode().Perm()&0077 != 0 {
		return errors.New("credential lock: directory must be private and not a symlink")
	}
	before, err := os.Lstat(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil && (!before.Mode().IsRegular() || runtime.GOOS != "windows" && before.Mode().Perm()&0077 != 0) {
		return errors.New("credential lock: file must be private and regular")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return err
	}
	named, err := os.Lstat(path)
	if err != nil || !named.Mode().IsRegular() || !os.SameFile(opened, named) || runtime.GOOS != "windows" && opened.Mode().Perm()&0077 != 0 {
		return errors.New("credential lock: file changed while opening")
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		locked, err := tryCredentialLock(f)
		if err != nil {
			return errors.New("credential lock: operating-system lock failed")
		}
		if locked {
			break
		}
		timer := time.NewTimer(50 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	defer releaseCredentialLock(f)
	return action()
}
