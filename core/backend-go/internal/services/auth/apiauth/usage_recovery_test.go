package apiauth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
)

type missingCounterReadBarrier struct {
	keystore.KeyStore
	reads sync.WaitGroup
}

func (b *missingCounterReadBarrier) GetItem(ctx context.Context, key string) (string, error) {
	value, err := b.KeyStore.GetItem(ctx, key)
	b.reads.Done()
	b.reads.Wait()
	return value, err
}

func TestCheckAndDecrementUsesRemaining_ConcurrentRecoveryRespectsLimit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := &missingCounterReadBarrier{KeyStore: keystore.NewMemoryKeyStore()}
	const requests = 24
	const limit = int64(5)
	store.reads.Add(requests)
	authenticator := &ApiAuthenticator{keyStore: store, identityPolicy: testIdentityPolicy(t)}
	identityID := uuid.New()
	results := make(chan error, requests)
	var wg sync.WaitGroup
	for range requests {
		wg.Go(func() {
			results <- authenticator.checkAndDecrementUsesRemaining(ctx, identityID, "recovery-fixture", limit)
		})
	}
	wg.Wait()
	close(results)
	allowed := 0
	for err := range results {
		if err == nil {
			allowed++
		} else {
			require.ErrorContains(t, err, "usage limit reached")
		}
	}
	require.Equal(t, int(limit), allowed)
}

type failingUsageStore struct {
	keystore.KeyStore
	failAt      string
	incremented bool
}

func (s *failingUsageStore) GetItem(ctx context.Context, key string) (string, error) {
	if s.failAt == "read" {
		return "", errors.New("cache unavailable")
	}
	return s.KeyStore.GetItem(ctx, key)
}

func (s *failingUsageStore) SetItemWithExpiryNX(ctx context.Context, key string, expiry time.Duration, value string) (bool, error) {
	if s.failAt == "seed" {
		return false, errors.New("cache unavailable")
	}
	return s.KeyStore.SetItemWithExpiryNX(ctx, key, expiry, value)
}

func (s *failingUsageStore) IncrementBy(ctx context.Context, key string, value int64) (int64, error) {
	s.incremented = true
	if s.failAt == "decrement" {
		return 0, errors.New("cache unavailable")
	}
	return s.KeyStore.IncrementBy(ctx, key, value)
}

func TestCheckAndDecrementUsesRemaining_CacheFailureDenies(t *testing.T) {
	t.Parallel()
	for _, operation := range []string{"read", "seed", "decrement"} {
		t.Run(operation, func(t *testing.T) {
			t.Parallel()
			store := &failingUsageStore{KeyStore: keystore.NewMemoryKeyStore(), failAt: operation}
			authenticator := &ApiAuthenticator{keyStore: store, identityPolicy: testIdentityPolicy(t)}
			err := authenticator.checkAndDecrementUsesRemaining(context.Background(), uuid.New(), "failure-fixture", 5)
			require.Error(t, err)
			require.Equal(t, operation == "decrement", store.incremented)
		})
	}
}

func TestCheckAndDecrementUsesRemaining_InvalidStateDenies(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := keystore.NewMemoryKeyStore()
	identityID := uuid.New()
	const tokenID = "invalid-state-fixture"
	key := identityTokenUsesRemainingKey(identityID.String(), tokenID)
	require.NoError(t, store.SetItem(ctx, key, "invalid-counter"))
	authenticator := &ApiAuthenticator{keyStore: store, identityPolicy: testIdentityPolicy(t)}
	require.Error(t, authenticator.checkAndDecrementUsesRemaining(ctx, identityID, tokenID, 5))
	value, err := store.GetItem(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "invalid-counter", value)
}
