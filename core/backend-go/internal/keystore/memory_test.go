package keystore

import (
	"context"
	"math"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMemoryKeyStore_IncrementByDecimal(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := NewMemoryKeyStore()
	for _, delta := range []int64{12, -1, -11, -9, 20} {
		value, err := store.IncrementBy(ctx, "counter", delta)
		require.NoError(t, err)
		stored, err := store.GetItem(ctx, "counter")
		require.NoError(t, err)
		require.Equal(t, strconv.FormatInt(value, 10), stored)
	}
	value, err := store.IncrementBy(ctx, "counter", 0)
	require.NoError(t, err)
	assert.Equal(t, int64(11), value)
}

func TestMemoryKeyStore_IncrementByBoundsAndInvalidInput(t *testing.T) {
	t.Parallel()
	for _, scenario := range []struct {
		name, initial string
		delta, want   int64
		invalid       bool
	}{
		{name: "maximum", initial: "0", delta: math.MaxInt64, want: math.MaxInt64},
		{name: "minimum", initial: "0", delta: math.MinInt64, want: math.MinInt64},
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
			t.Parallel()
			ctx := context.Background()
			store := NewMemoryKeyStore()
			require.NoError(t, store.SetItemWithExpiry(ctx, "counter", time.Hour, scenario.initial))
			before := store.items["counter"]
			value, err := store.IncrementBy(ctx, "counter", scenario.delta)
			if scenario.invalid {
				require.Error(t, err)
				assert.NotContains(t, err.Error(), "private")
				assert.Equal(t, before, store.items["counter"])
				return
			}
			require.NoError(t, err)
			assert.Equal(t, scenario.want, value)
			assert.Equal(t, strconv.FormatInt(scenario.want, 10), store.items["counter"].value)
			assert.Equal(t, before.expiresAt, store.items["counter"].expiresAt)
		})
	}
}

func TestMemoryKeyStore_IncrementByExpiredKey(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := NewMemoryKeyStore()
	require.NoError(t, store.SetItemWithExpiry(ctx, "counter", -time.Second, "99"))
	value, err := store.IncrementBy(ctx, "counter", -2)
	require.NoError(t, err)
	assert.Equal(t, int64(-2), value)
	assert.Equal(t, "-2", store.items["counter"].value)
	assert.True(t, store.items["counter"].expiresAt.IsZero())
}

func TestMemoryKeyStore_IncrementByConcurrent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := NewMemoryKeyStore()
	const workers = 64
	var wg sync.WaitGroup
	results := make(chan error, workers)
	for range workers {
		wg.Go(func() {
			_, err := store.IncrementBy(ctx, "counter", 1)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	value, err := store.GetItem(ctx, "counter")
	require.NoError(t, err)
	assert.Equal(t, strconv.Itoa(workers), value)
}
