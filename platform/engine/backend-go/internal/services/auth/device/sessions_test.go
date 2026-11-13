package device

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDeviceSessions_LifetimePolicy(t *testing.T) {
	for _, test := range []struct {
		value  string
		want   time.Duration
		denied bool
	}{
		{"", 24 * time.Hour, false}, {"1m", time.Minute, false}, {"2h", 2 * time.Hour, false},
		{"1d", 24 * time.Hour, false}, {"1w", 24 * time.Hour, false}, {"999999999999999999d", 24 * time.Hour, false},
		{"0m", 0, true}, {"-1h", 0, true}, {"1.5h", 0, true}, {"1h ", 0, true}, {"1s", 0, true},
		{"18446744073709551616w", 0, true},
	} {
		t.Run(test.value, func(t *testing.T) {
			got, err := cappedLifetime(test.value, 24*time.Hour)
			if test.denied {
				require.ErrorIs(t, err, ErrDenied)
			} else {
				require.NoError(t, err)
				require.Equal(t, test.want, got)
			}
		})
	}
}
