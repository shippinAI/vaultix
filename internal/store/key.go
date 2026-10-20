package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"

	"github.com/zalando/go-keyring"
)

const service = "vaultix"

// DataKey returns the local data key: from keyFile (0600) when set, else from the OS keyring,
// creating a random one on first use.
func DataKey(keyFile string) ([]byte, error) {
	if keyFile != "" {
		return fileKey(keyFile)
	}
	if h, err := keyring.Get(service, "data-key"); err == nil {
		return hex.DecodeString(h)
	} else if !errors.Is(err, keyring.ErrNotFound) {
		return nil, err
	}
	k, err := newKey()
	if err != nil {
		return nil, err
	}
	return k, keyring.Set(service, "data-key", hex.EncodeToString(k))
}

func fileKey(p string) ([]byte, error) {
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		k, err := newKey()
		if err != nil {
			return nil, err
		}
		return k, os.WriteFile(p, []byte(hex.EncodeToString(k)+"\n"), 0o600)
	}
	if err != nil {
		return nil, err
	}
	if fi, err := os.Stat(p); err == nil && fi.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("store: key file must not be readable by group/others")
	}
	return hex.DecodeString(strings.TrimSpace(string(b)))
}

func newKey() ([]byte, error) {
	k := make([]byte, 32)
	_, err := rand.Read(k)
	return k, err
}

// Credential stores and reads the login token in the OS keyring (or returns the env override).
func Credential(set string) (string, error) {
	if set != "" {
		return "", keyring.Set(service, "token", set)
	}
	if t := os.Getenv("VAULTIX_TOKEN"); t != "" {
		return t, nil
	}
	if f := os.Getenv("VAULTIX_TOKEN_FILE"); f != "" {
		b, err := os.ReadFile(f)
		return strings.TrimSpace(string(b)), err
	}
	return keyring.Get(service, "token")
}

// Forget removes the stored login token.
func Forget() error { return keyring.Delete(service, "token") }
