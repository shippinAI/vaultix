package store

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// CredentialFile is an explicit headless alternative to the keyring. The
// containing directory must already be private. Windows uses its OS keyring;
// POSIX mode bits cannot establish a Windows file's ACL privacy.
func CredentialFile(path, set string) (string, error) {
	if runtime.GOOS == "windows" {
		return "", errors.New("credential files require POSIX permissions; use the Windows credential manager")
	}
	dir := filepath.Dir(path)
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o077 != 0 {
		return "", errors.New("credential directory must exist with mode 0700")
	}
	info, err = os.Lstat(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err == nil && (!info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0) {
		return "", errors.New("credential file must be a regular file with mode 0600")
	}
	if set == "" {
		file, err := os.Open(path)
		if err != nil {
			return "", err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 65537))
		if err != nil || len(data) > 65536 {
			return "", errors.New("invalid credential file")
		}
		return strings.TrimSpace(string(data)), nil
	}
	file, err := os.CreateTemp(dir, ".vaultix-credential-*")
	if err != nil {
		return "", err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if _, err = file.WriteString(set + "\n"); err != nil {
		file.Close()
		return "", err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return "", err
	}
	if err = file.Close(); err != nil {
		return "", err
	}
	return "", os.Rename(tmp, path)
}

func ForgetCredentialFile(path string) error {
	if _, err := CredentialFile(path, ""); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return os.Remove(path)
}
