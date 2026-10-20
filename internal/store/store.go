// Package store keeps the local copy of each scope encrypted at rest (AES-256-GCM). The data
// key lives in the OS keyring; headless hosts may use a 0600 key file instead.
package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Entry is one local secret: its value, the server version it was based on, and whether it
// was changed locally since the last sync.
type Entry struct {
	Value string `json:"v"`
	Base  int    `json:"b"`
	Dirty bool   `json:"d,omitempty"`
}

// Scope is the local state of one project/env/path.
type Scope struct {
	Entries map[string]Entry `json:"entries"`
	// Deleted holds keys removed locally (with their base version) until pushed.
	Deleted map[string]int `json:"deleted,omitempty"`
}

// Store reads and writes encrypted scope files under Dir.
type Store struct {
	Dir string
	Key []byte // 32 bytes
}

func (s *Store) file(name string) string { return filepath.Join(s.Dir, name+".vx") }

// Load returns the scope, or an empty one if it was never synced.
func (s *Store) Load(name string) (*Scope, error) {
	sc := &Scope{Entries: map[string]Entry{}, Deleted: map[string]int{}}
	b, err := os.ReadFile(s.file(name))
	if errors.Is(err, os.ErrNotExist) {
		return sc, nil
	}
	if err != nil {
		return nil, err
	}
	plain, err := s.open(b)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(plain, sc); err != nil {
		return nil, err
	}
	if sc.Deleted == nil {
		sc.Deleted = map[string]int{}
	}
	return sc, nil
}

// Save writes the scope atomically with mode 0600.
func (s *Store) Save(name string, sc *Scope) error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	plain, err := json.Marshal(sc)
	if err != nil {
		return err
	}
	b, err := s.seal(plain)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.Dir, ".vx-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.file(name))
}

func (s *Store) aead() (cipher.AEAD, error) {
	if len(s.Key) != 32 {
		return nil, errors.New("store: key must be 32 bytes")
	}
	blk, err := aes.NewCipher(s.Key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(blk)
}

func (s *Store) seal(plain []byte) ([]byte, error) {
	g, err := s.aead()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return g.Seal(nonce, nonce, plain, []byte("vaultix/v1")), nil
}

func (s *Store) open(b []byte) ([]byte, error) {
	g, err := s.aead()
	if err != nil {
		return nil, err
	}
	if len(b) < g.NonceSize() {
		return nil, errors.New("store: file too short")
	}
	return g.Open(nil, b[:g.NonceSize()], b[g.NonceSize():], []byte("vaultix/v1"))
}
