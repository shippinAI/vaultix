package pinauth

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"shippin.cloud/vaultix/panel/internal/store"
)

const testKey = "000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f"

func newAuth(t *testing.T) *Authenticator {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "state.json"), testKey)
	if err != nil {
		t.Fatal(err)
	}
	return New(st)
}

func TestSetAndStepUp(t *testing.T) {
	a := newAuth(t)
	if err := a.SetPin("jessay", "prod", "", "482913"); err != nil {
		t.Fatalf("set: %v", err)
	}
	token, exp, err := a.StepUp("jessay", "prod", "482913")
	if err != nil {
		t.Fatalf("stepup: %v", err)
	}
	if token == "" || !exp.After(time.Now()) {
		t.Fatal("expected token with future expiry")
	}
	sess, err := a.Check("jessay", token)
	if err != nil || sess.InstanceID != "prod" {
		t.Fatalf("check: %v %+v", err, sess)
	}
	if _, err := a.Check("someone-else", token); !errors.Is(err, ErrNoElev) {
		t.Fatal("token must be bound to the user")
	}
}

func TestWeakAndWrongPin(t *testing.T) {
	a := newAuth(t)
	if err := a.SetPin("u", "i", "", "12"); !errors.Is(err, ErrWeakPin) {
		t.Fatalf("want ErrWeakPin, got %v", err)
	}
	if err := a.SetPin("u", "i", "", "abc123"); !errors.Is(err, ErrWeakPin) {
		t.Fatalf("digits only: got %v", err)
	}
	if err := a.SetPin("u", "i", "", "123456"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.StepUp("u", "i", "654321"); !errors.Is(err, ErrBadPin) {
		t.Fatalf("want ErrBadPin, got %v", err)
	}
	// Changing without the current PIN must fail.
	if err := a.SetPin("u", "i", "999999", "111111"); err == nil {
		t.Fatal("change without current pin must fail")
	}
}

func TestLockoutAndBackoff(t *testing.T) {
	a := newAuth(t)
	now := time.Now()
	a.now = func() time.Time { return now }
	if err := a.SetPin("u", "i", "", "123456"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxFailures-1; i++ {
		if _, _, err := a.StepUp("u", "i", "000000"); !errors.Is(err, ErrBadPin) {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	if _, _, err := a.StepUp("u", "i", "000000"); !errors.Is(err, ErrLocked) {
		t.Fatalf("5th failure must lock: %v", err)
	}
	// Correct PIN while locked still refused.
	if _, _, err := a.StepUp("u", "i", "123456"); !errors.Is(err, ErrLocked) {
		t.Fatalf("locked must refuse even correct pin: %v", err)
	}
	// After the lock expires, correct PIN works and resets the counter.
	now = now.Add(2 * time.Minute)
	if _, _, err := a.StepUp("u", "i", "123456"); err != nil {
		t.Fatalf("after lockout: %v", err)
	}
}

func TestSessionExpiry(t *testing.T) {
	a := newAuth(t)
	now := time.Now()
	a.now = func() time.Time { return now }
	if err := a.SetPin("u", "i", "", "123456"); err != nil {
		t.Fatal(err)
	}
	token, _, err := a.StepUp("u", "i", "123456")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(SessionTTL + time.Second)
	if _, err := a.Check("u", token); !errors.Is(err, ErrNoElev) {
		t.Fatalf("expired session must fail: %v", err)
	}
}
