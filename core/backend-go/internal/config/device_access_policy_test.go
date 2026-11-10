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
	// Off by default; once enabled, a delegated session lasts at least the next hour (docs/0120).
	require.Equal(t, time.Hour, policy.Lifetime)
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

func TestDeviceAuthorizationPolicy_RequiresResourceValidation(t *testing.T) {
	for _, test := range []struct {
		value                  string
		access, enabled, valid bool
	}{
		{"", false, false, true}, {"false", false, false, true}, {"true", false, false, false},
		{"true", true, true, true}, {"false", true, false, true}, {"yes", true, false, false},
	} {
		t.Run(test.value, func(t *testing.T) {
			enabled, err := ParseDeviceAuthorizationEnabled(test.value, DeviceAccessPolicy{Enabled: test.access})
			if !test.valid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.enabled, enabled)
		})
	}
}
