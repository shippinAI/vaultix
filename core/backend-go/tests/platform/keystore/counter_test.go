//go:build integration

package keystore_test

import (
	"context"
	"math"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/tests/infra"
)

var stack *infra.Stack

func TestMain(m *testing.M) {
	stack = infra.New().WithPostgres().WithRedis().MustStart()
	code := m.Run()
	stack.Stop()
	os.Exit(code)
}

func TestCounter_DecimalAndExpiry(t *testing.T) {
	ctx := context.Background()
	client := stack.Redis().Client()
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	store := keystore.NewKeyStore(client)
	key := "vaultix-counter-proof:" + uuid.NewString()
	t.Cleanup(func() { _, err := store.DeleteItem(ctx, key); require.NoError(t, err) })
	require.NoError(t, store.SetItemWithExpiry(ctx, key, time.Hour, "12"))
	for _, want := range []int64{11, 10, 9, 8} {
		value, err := store.IncrementBy(ctx, key, -1)
		require.NoError(t, err)
		assert.Equal(t, want, value)
		stored, err := store.GetItem(ctx, key)
		require.NoError(t, err)
		assert.Equal(t, strconv.FormatInt(want, 10), stored)
	}
	ttl, err := client.PTTL(ctx, key).Result()
	require.NoError(t, err)
	assert.Positive(t, ttl)
	assert.LessOrEqual(t, ttl, time.Hour)
	expired, err := store.SetExpiry(ctx, key, -time.Second)
	require.NoError(t, err)
	require.True(t, expired)
	value, err := store.IncrementBy(ctx, key, -2)
	require.NoError(t, err)
	assert.Equal(t, int64(-2), value)
	ttl, err = client.PTTL(ctx, key).Result()
	require.NoError(t, err)
	assert.Equal(t, time.Duration(-1), ttl)
}

func TestCounter_IntegerContractMatchesMemory(t *testing.T) {
	ctx := context.Background()
	client := stack.Redis().Client()
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	for _, scenario := range []struct {
		name, initial string
		delta         int64
		invalid       bool
	}{
		{name: "maximum", initial: "0", delta: math.MaxInt64},
		{name: "minimum", initial: "0", delta: math.MinInt64},
		{name: "positive overflow", initial: "9223372036854775807", delta: 1, invalid: true},
		{name: "negative overflow", initial: "-9223372036854775808", delta: -1, invalid: true},
		{name: "empty", initial: "", delta: 1, invalid: true},
		{name: "letters", initial: "1private2", delta: 1, invalid: true},
		{name: "space", initial: " 1", delta: 1, invalid: true},
		{name: "plus", initial: "+1", delta: 1, invalid: true},
		{name: "leading zero", initial: "01", delta: 1, invalid: true},
		{name: "negative zero", initial: "-0", delta: 1, invalid: true},
		{name: "out of range", initial: "9223372036854775808", delta: 1, invalid: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			key := "vaultix-counter-proof:" + uuid.NewString()
			remote := keystore.NewKeyStore(client)
			t.Cleanup(func() { _, err := remote.DeleteItem(ctx, key); require.NoError(t, err) })
			for _, store := range []keystore.KeyStore{remote, keystore.NewMemoryKeyStore()} {
				require.NoError(t, store.SetItem(ctx, key, scenario.initial))
				value, err := store.IncrementBy(ctx, key, scenario.delta)
				if scenario.invalid {
					require.Error(t, err)
				} else {
					require.NoError(t, err)
					assert.Equal(t, scenario.delta, value)
				}
				stored, err := store.GetItem(ctx, key)
				require.NoError(t, err)
				if scenario.invalid {
					assert.Equal(t, scenario.initial, stored)
				} else {
					assert.Equal(t, strconv.FormatInt(value, 10), stored)
				}
			}
		})
	}
}

func TestCounter_ConcurrentIncrements(t *testing.T) {
	ctx := context.Background()
	client := stack.Redis().Client()
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	store := keystore.NewKeyStore(client)
	key := "vaultix-counter-proof:" + uuid.NewString()
	t.Cleanup(func() { _, err := store.DeleteItem(ctx, key); require.NoError(t, err) })
	const workers = 64
	var wg sync.WaitGroup
	results := make(chan error, workers)
	for range workers {
		wg.Go(func() {
			_, err := store.IncrementBy(ctx, key, 1)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	stored, err := store.GetItem(ctx, key)
	require.NoError(t, err)
	assert.Equal(t, strconv.Itoa(workers), stored)
}
