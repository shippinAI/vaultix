package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDeviceAccessPolicy_StrictRollout(t *testing.T) {
	policy, err := ParseDeviceAccessPolicy("", "")
	require.NoError(t, err)
	require.False(t, policy.Enabled)
	require.Equal(t, 15*time.Minute, policy.Lifetime)
	for _, test := range []struct {
		enabled, seconds string
		valid            bool
	}{
		{"true", "1", true}, {"true", "86400", true}, {"false", "900", true},
		{"yes", "900", false}, {"false", "0", false}, {"true", "86401", false},
		{"true", "-1", false}, {"true", "1.5", false}, {"true", "1s", false},
		{"true", " 900", false}, {"true", "999999999999999999999", false},
	} {
		t.Run(test.enabled+"/"+test.seconds, func(t *testing.T) {
			_, err := ParseDeviceAccessPolicy(test.enabled, test.seconds)
			if test.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
