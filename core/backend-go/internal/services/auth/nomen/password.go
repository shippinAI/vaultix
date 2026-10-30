package nomen

import (
	"context"
	"crypto/fips140"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"strconv"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/pbkdf2"
)

// Verification mirrors stored Node bcrypt/PBKDF2 formats. It does not migrate
// hashes or establish FIPS validation. Slots remain occupied after cancellation
// until the bounded CPU operation ends; canceled callers cannot fan out workers.
func verifyPassword(ctx context.Context, slots chan struct{}, password, encoded string) error {
	if password == "" || len(password) > 1024 || len(encoded) > 256 {
		return ErrLinkDenied
	}
	var verify func() bool
	switch {
	case strings.HasPrefix(encoded, "$2"):
		cost, err := bcrypt.Cost([]byte(encoded))
		if err != nil || cost > 20 || fips140.Enabled() {
			return ErrReauthenticationMethod
		}
		// Node bcrypt truncates bytes at 72, including multibyte UTF-8 passwords.
		input := []byte(password)
		if len(input) > 72 {
			input = input[:72]
		}
		verify = func() bool { return bcrypt.CompareHashAndPassword([]byte(encoded), input) == nil }
	case strings.HasPrefix(encoded, "$v1$"):
		parts := strings.Split(encoded, "$")
		if len(parts) != 4 {
			return ErrLinkDenied
		}
		cost, err := strconv.Atoi(parts[2])
		combined, decodeErr := base64.StdEncoding.Strict().DecodeString(parts[3])
		if err != nil || cost < 10 || cost > 20 || strconv.Itoa(cost) != parts[2] || decodeErr != nil || len(combined) != 48 {
			return ErrLinkDenied
		}
		iterations := cost * cost * cost * cost * cost * cost
		verify = func() bool {
			derived := pbkdf2.Key([]byte(password), combined[:16], iterations, 32, sha256.New)
			return subtle.ConstantTimeCompare(derived, combined[16:]) == 1
		}
	default:
		return ErrReauthenticationMethod
	}
	if err := ctx.Err(); err != nil {
		return ErrLinkDenied
	}
	select {
	case slots <- struct{}{}:
	default:
		return ErrReauthenticationBusy
	}
	done := make(chan bool, 1)
	go func() {
		defer func() { <-slots }()
		done <- verify()
	}()
	select {
	case valid := <-done:
		if !valid || ctx.Err() != nil {
			return ErrLinkDenied
		}
		return nil
	case <-ctx.Done():
		return ErrLinkDenied
	}
}
