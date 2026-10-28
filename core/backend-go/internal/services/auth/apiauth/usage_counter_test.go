package apiauth

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
)

func TestCheckAndDecrementUsesRemaining_SeededCounterExhausts(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := keystore.NewMemoryKeyStore()
	authenticator := &ApiAuthenticator{keyStore: store, identityPolicy: testIdentityPolicy(t)}
	identityID := uuid.New()
	const tokenID = "fixture-token-id"
	const limit = int64(5)
	key := identityTokenUsesRemainingKey(identityID.String(), tokenID)
	require.NoError(t, store.SetItemWithExpiry(ctx, key, time.Hour, strconv.FormatInt(limit, 10)))
	for remaining := limit - 1; remaining >= 0; remaining-- {
		require.NoError(t, authenticator.checkAndDecrementUsesRemaining(ctx, identityID, tokenID, limit))
		stored, err := store.GetItem(ctx, key)
		require.NoError(t, err)
		require.Equal(t, strconv.FormatInt(remaining, 10), stored)
	}
	for range 3 {
		err := authenticator.checkAndDecrementUsesRemaining(ctx, identityID, tokenID, limit)
		require.ErrorContains(t, err, "usage limit reached")
	}
}
