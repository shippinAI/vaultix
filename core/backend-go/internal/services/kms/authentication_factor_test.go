package kms

import (
	"bytes"
	"context"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAuthenticationFactorNodeCipherCompatibility(t *testing.T) {
	// Independently encrypted with Node AES-256-GCM; public fixture key/IV.
	encrypted, err := hex.DecodeString("03030303030303030303030362bbf9471d661c143d197008ba18b55d431dbb95f7c9bfee14af67c534d5482f")
	require.NoError(t, err)
	service := &Service{rootEncryptionKey: bytes.Repeat([]byte{7}, 32)}
	plaintext, err := service.DecryptAuthenticationFactor(context.Background(), encrypted)
	require.NoError(t, err)
	require.Equal(t, "GEZDGNBVGY3TQOJQ", string(plaintext))
	require.Equal(t, bytes.Repeat([]byte{7}, 32), service.rootEncryptionKey)
	clear(plaintext)
	encrypted[len(encrypted)-1] ^= 1
	plaintext, err = service.DecryptAuthenticationFactor(context.Background(), encrypted)
	require.Error(t, err)
	require.Nil(t, plaintext)
	encrypted[len(encrypted)-1] ^= 1
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	plaintext, err = service.DecryptAuthenticationFactor(ctx, encrypted)
	require.Error(t, err)
	require.Nil(t, plaintext)
	service.Close()
	plaintext, err = service.DecryptAuthenticationFactor(context.Background(), encrypted)
	require.Error(t, err)
	require.Nil(t, plaintext)
	for _, blob := range [][]byte{nil, make([]byte, 27), make([]byte, 513)} {
		plaintext, err = service.DecryptAuthenticationFactor(context.Background(), blob)
		require.Error(t, err)
		require.Nil(t, plaintext)
	}
}
