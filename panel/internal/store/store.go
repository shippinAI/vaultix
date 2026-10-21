// Package store is the panel's durable state: PIN records and the source
// link. One JSON file, atomic writes. Secret material is sealed (AES-GCM)
// before it touches disk; PIN hashes are argon2id and never reversible.
package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var ErrNotFound = errors.New("not found")

// PinRecord holds one user's PIN for one instance. Hash is argon2id.
type PinRecord struct {
	Hash        string    `json:"hash"` // encoded argon2id string
	FailCount   int       `json:"failCount"`
	LockedUntil time.Time `json:"lockedUntil"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// LinkRecord is the external-source link (the migration source a user
// connected). SealedCredential is AES-GCM-sealed JSON (client id/secret,
// read scope only) and never leaves the process.
type LinkRecord struct {
	Source           string           `json:"source"`
	BaseURL          string           `json:"baseUrl"`
	SealedCredential string           `json:"sealedCredential"`
	Projects         []ProjectMapping `json:"projects"`
	CreatedBy        string           `json:"createdBy"`
	CreatedAt        time.Time        `json:"createdAt"`
	LastImportAt     time.Time        `json:"lastImportAt,omitempty"`
	LastImportNote   string           `json:"lastImportNote,omitempty"`
}

// ProjectMapping pairs a source workspace with the local Vaultix project the
// import writes into. Local projects are created by the operator first.
type ProjectMapping struct {
	SourceProjectID string `json:"sourceProjectId"`
	LocalProjectID  string `json:"localProjectId"`
}

// Credential is what gets sealed. Read scope only, enforced by policy on the
// source side (the identity we ask users to create is read-only).
type Credential struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type state struct {
	Pins map[string]PinRecord `json:"pins"` // key: user + "\x00" + instanceID
	Link *LinkRecord          `json:"link,omitempty"`
}

type Store struct {
	mu     sync.Mutex
	path   string
	aead   cipher.AEAD
	state  state
	loaded bool
}

// Open loads (or initializes) the state file. encKeyHex must be 64 hex chars
// (32 bytes); losing it makes the sealed link credential unrecoverable, which
// is the correct failure mode.
func Open(path, encKeyHex string) (*Store, error) {
	key, err := hex.DecodeString(encKeyHex)
	if err != nil || len(key) != 32 {
		return nil, errors.New("store: encryption key must be 64 hex chars (32 bytes)")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	s := &Store{path: path, aead: aead, state: state{Pins: map[string]PinRecord{}}}
	raw, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		// fresh state
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(raw, &s.state); err != nil {
			return nil, fmt.Errorf("store: state file corrupt: %w", err)
		}
		if s.state.Pins == nil {
			s.state.Pins = map[string]PinRecord{}
		}
	}
	s.loaded = true
	return s, nil
}

func pinKey(user, instanceID string) string { return user + "\x00" + instanceID }

func (s *Store) GetPin(user, instanceID string) (PinRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.state.Pins[pinKey(user, instanceID)]
	return r, ok
}

func (s *Store) PutPin(user, instanceID string, r PinRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Pins[pinKey(user, instanceID)] = r
	return s.saveLocked()
}

func (s *Store) GetLink() (LinkRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Link == nil {
		return LinkRecord{}, false
	}
	return *s.state.Link, true
}

func (s *Store) PutLink(l LinkRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Link = &l
	return s.saveLocked()
}

func (s *Store) UpdateLink(fn func(*LinkRecord)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Link == nil {
		return ErrNotFound
	}
	fn(s.state.Link)
	return s.saveLocked()
}

// DeleteLink removes the link and its sealed credential. It never calls out
// to the source side — unlink is local by design (doc 0004 §3).
func (s *Store) DeleteLink() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Link == nil {
		return ErrNotFound
	}
	s.state.Link = nil
	return s.saveLocked()
}

// Seal encrypts a credential for at-rest storage.
func (s *Store) Seal(c Credential) (string, error) {
	plain, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := s.aead.Seal(nonce, nonce, plain, nil)
	return hex.EncodeToString(out), nil
}

// Unseal decrypts a sealed credential. Only the importer calls this; no HTTP
// handler ever returns the result.
func (s *Store) Unseal(sealed string) (Credential, error) {
	raw, err := hex.DecodeString(sealed)
	if err != nil {
		return Credential{}, err
	}
	ns := s.aead.NonceSize()
	if len(raw) < ns {
		return Credential{}, errors.New("store: sealed blob too short")
	}
	plain, err := s.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return Credential{}, errors.New("store: unseal failed (wrong key?)")
	}
	var c Credential
	if err := json.Unmarshal(plain, &c); err != nil {
		return Credential{}, err
	}
	return c, nil
}

func (s *Store) saveLocked() error {
	raw, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
