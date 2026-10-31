package kms

import (
	"context"
	"errors"

	"github.com/vaultix/api/internal/libs/crypto/cipher"
)

// DecryptAuthenticationFactor reads the existing root-protected factor format.
// It performs no database or provider I/O and never exposes the root key. This
// is internal cryptographic infrastructure, not a public secret-value endpoint.
func (s *Service) DecryptAuthenticationFactor(ctx context.Context, encrypted []byte) ([]byte, error) {
	if ctx.Err() != nil || len(encrypted) < 28 || len(encrypted) > 512 {
		return nil, errors.New("authentication factor is unavailable")
	}
	key := s.getRootKey()
	defer clear(key)
	if len(key) != 32 {
		return nil, errors.New("authentication factor is unavailable")
	}
	plaintext, err := cipher.SymmetricDecrypt(encrypted, key)
	if err != nil || ctx.Err() != nil {
		clear(plaintext)
		return nil, errors.New("authentication factor is unavailable")
	}
	return plaintext, nil
}
