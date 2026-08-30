// Package pinauth implements the PIN step-up from doc 0004 §2: argon2id at
// rest, per-user per-instance, lockout with backoff, and short-lived elevated
// sessions kept in memory only (a restart re-prompts, which is fine).
package pinauth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"

	"shippin.cloud/vaultix/panel/internal/store"
)

const (
	argonTime    = 3
	argonMemory  = 64 * 1024 // KiB
	argonThreads = 4
	argonKeyLen  = 32

	MaxFailures = 5
	SessionTTL  = 15 * time.Minute
)

var (
	ErrLocked  = errors.New("pin locked")
	ErrBadPin  = errors.New("pin incorrect")
	ErrNoPin   = errors.New("no pin set")
	ErrWeakPin = errors.New("pin must be 6-12 digits")
	ErrNoElev  = errors.New("elevated session invalid or expired")
)

type Session struct {
	User       string
	InstanceID string
	ExpiresAt  time.Time
}

type Authenticator struct {
	store *store.Store

	mu       sync.Mutex
	sessions map[string]Session
	now      func() time.Time // test hook
}

func New(s *store.Store) *Authenticator {
	return &Authenticator{store: s, sessions: map[string]Session{}, now: time.Now}
}

// SetPin sets or changes a PIN. Changing requires the current PIN; recovery
// without it goes through Nomen re-auth at the panel layer, not here.
func (a *Authenticator) SetPin(user, instanceID, currentPin, newPin string) error {
	if !validPin(newPin) {
		return ErrWeakPin
	}
	if rec, ok := a.store.GetPin(user, instanceID); ok {
		if err := a.checkLocked(rec); err != nil {
			return err
		}
		if !verify(rec.Hash, currentPin) {
			return a.recordFailure(user, instanceID, rec)
		}
	}
	h, err := hash(newPin)
	if err != nil {
		return err
	}
	return a.store.PutPin(user, instanceID, store.PinRecord{Hash: h, UpdatedAt: a.now()})
}

// StepUp verifies the PIN and mints an elevated session token.
func (a *Authenticator) StepUp(user, instanceID, pin string) (token string, exp time.Time, err error) {
	rec, ok := a.store.GetPin(user, instanceID)
	if !ok {
		return "", time.Time{}, ErrNoPin
	}
	if err := a.checkLocked(rec); err != nil {
		return "", time.Time{}, err
	}
	if !verify(rec.Hash, pin) {
		return "", time.Time{}, a.recordFailure(user, instanceID, rec)
	}
	rec.FailCount = 0
	rec.LockedUntil = time.Time{}
	if err := a.store.PutPin(user, instanceID, rec); err != nil {
		return "", time.Time{}, err
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", time.Time{}, err
	}
	token = hex.EncodeToString(buf)
	exp = a.now().Add(SessionTTL)
	a.mu.Lock()
	a.sessions[token] = Session{User: user, InstanceID: instanceID, ExpiresAt: exp}
	a.mu.Unlock()
	return token, exp, nil
}

// Check validates an elevated token for a user. Returns the session so the
// caller can enforce instance scope where the route carries one.
func (a *Authenticator) Check(user, token string) (Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	sess, ok := a.sessions[token]
	if ok && a.now().After(sess.ExpiresAt) {
		delete(a.sessions, token)
		ok = false
	}
	// User mismatch must not delete the session — that would let anyone
	// invalidate a victim's step-up by replaying their token.
	if !ok || sess.User != user {
		return Session{}, ErrNoElev
	}
	return sess, nil
}

func (a *Authenticator) checkLocked(rec store.PinRecord) error {
	if rec.LockedUntil.After(a.now()) {
		return fmt.Errorf("%w until %s", ErrLocked, rec.LockedUntil.UTC().Format(time.RFC3339))
	}
	return nil
}

// recordFailure bumps the counter and applies backoff: after MaxFailures,
// lock 1m doubling per extra failure, capped at 1h. Always returns ErrBadPin
// (or ErrLocked wrapped) so callers can't distinguish.
func (a *Authenticator) recordFailure(user, instanceID string, rec store.PinRecord) error {
	rec.FailCount++
	if rec.FailCount >= MaxFailures {
		over := rec.FailCount - MaxFailures
		if over > 6 {
			over = 6 // 1m << 6 = 64m ≈ cap
		}
		d := time.Minute << uint(over)
		if d > time.Hour {
			d = time.Hour
		}
		rec.LockedUntil = a.now().Add(d)
	}
	if err := a.store.PutPin(user, instanceID, rec); err != nil {
		return err
	}
	if rec.LockedUntil.After(a.now()) {
		return fmt.Errorf("%w until %s", ErrLocked, rec.LockedUntil.UTC().Format(time.RFC3339))
	}
	return ErrBadPin
}

func validPin(pin string) bool {
	if len(pin) < 6 || len(pin) > 12 {
		return false
	}
	for _, r := range pin {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func hash(pin string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(pin), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func verify(encoded, pin string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(pin), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}
