package nomen

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVerifyPassword_NodeCompatibility(t *testing.T) {
	data, err := os.ReadFile("testdata/password-node-v1.json")
	require.NoError(t, err)
	var fixture struct {
		Vectors []struct{ Password, Hash string }
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Len(t, fixture.Vectors, 3)
	for _, vector := range fixture.Vectors {
		require.NoError(t, verifyPassword(context.Background(), make(chan struct{}, 2), vector.Password, vector.Hash))
		require.ErrorIs(t, verifyPassword(context.Background(), make(chan struct{}, 2), "wrong-prefix"+vector.Password, vector.Hash), ErrLinkDenied)
	}
}

func TestVerifyPassword_BoundsAdmissionAndCancellation(t *testing.T) {
	const encoded = "$2b$04$EnwJ5WPEU83MZVuPzpOW2eR9WP4dCMDEP2y31pJGalkjcyP0Yr6Ku"
	for _, invalid := range []string{"", strings.Repeat("x", 1025)} {
		require.ErrorIs(t, verifyPassword(context.Background(), make(chan struct{}, 2), invalid, encoded), ErrLinkDenied)
	}
	for _, malformed := range []string{"$v1$10$broken", "$v1$21$AAAA", "$v1$10.0$AAAA", "$v1$10"} {
		require.ErrorIs(t, verifyPassword(context.Background(), make(chan struct{}, 2), "fixture", malformed), ErrLinkDenied)
	}
	require.ErrorIs(t, verifyPassword(context.Background(), make(chan struct{}, 2), "fixture", "$2b$31$EnwJ5WPEU83MZVuPzpOW2eR9WP4dCMDEP2y31pJGalkjcyP0Yr6Ku"), ErrReauthenticationMethod)
	slots := make(chan struct{}, 1)
	slots <- struct{}{}
	require.ErrorIs(t, verifyPassword(context.Background(), slots, "fixture", encoded), ErrReauthenticationBusy)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.ErrorIs(t, verifyPassword(ctx, make(chan struct{}, 2), "fixture", encoded), ErrLinkDenied)
}
