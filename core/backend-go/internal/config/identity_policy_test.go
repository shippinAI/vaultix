package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func setIdentityPolicyConfigFixture(t *testing.T) {
	t.Helper()
	for key, value := range map[string]string{
		"DB_CONNECTION_URI": "postgres://fixture:fixture@127.0.0.1:1/unused",
		"REDIS_URL":         "redis://127.0.0.1:1", "ENCRYPTION_KEY": "fixture", "AUTH_SECRET": "fixture",
		"NODE_ENV": "test", "PORT": "4040", "DB_READ_REPLICAS": "",
		"REDIS_SENTINEL_HOSTS": "", "REDIS_CLUSTER_HOSTS": "", "REDIS_READ_REPLICAS": "",
		"MAX_MACHINE_IDENTITY_TOKEN_AGE":                      "90d",
		"LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT": "2026-05-04T00:00:00.000Z",
	} {
		t.Setenv(key, value)
	}
}

func TestParseIdentityTokenPolicy_ConfigurationContract(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		input   string
		seconds int64
	}{
		{"", 7776000}, {" \t ", 7776000}, {" 90d ", 7776000}, {"2 HOURS", 7200},
		{".5h", 1800}, {"1.999s", 1}, {"1999", 1}, {"2 weeks", 1209600},
		{"1y", 31557600}, {"9223372036s", 9223372036},
	} {
		t.Run(tc.input, func(t *testing.T) {
			policy, err := ParseIdentityTokenPolicy(tc.input, "")
			require.NoError(t, err)
			require.True(t, policy.Valid())
			require.Equal(t, time.Duration(tc.seconds)*time.Second, policy.MaxAge())
			require.Equal(t, time.Date(2026, 5, 4, 0, 0, 0, 0, time.UTC).Add(policy.MaxAge()), policy.LegacyDeadline())
		})
	}
	for _, input := range []string{"", "  ", "2026-05-04", "2026-05-04T00:00:00Z", "2026-05-03T20:00:00-04:00"} {
		policy, err := ParseIdentityTokenPolicy("2h", input)
		require.NoError(t, err)
		require.Equal(t, time.Date(2026, 5, 4, 2, 0, 0, 0, time.UTC), policy.LegacyDeadline())
	}
	policy, err := ParseIdentityTokenPolicy("1s", "2026-05-04T00:00:00.123456Z")
	require.NoError(t, err)
	require.Equal(t, time.Date(2026, 5, 4, 0, 0, 1, 123000000, time.UTC), policy.LegacyDeadline())
	_, err = ParseIdentityTokenPolicy("9223372037s", "")
	require.Error(t, err)
}

func TestParseIdentityTokenPolicy_CanonicalIssuerDate(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		value        string
		milliseconds int64
	}{
		{"unix-ms:1777852800000", 1777852800000}, {"unix-ms:-1", -1}, {"unix-ms:0", 0},
		{"unix-ms:-8640000000000000", -8640000000000000}, {"unix-ms:8640000000000000", 8640000000000000},
	} {
		policy, err := ParseIdentityTokenPolicy("2h", tc.value)
		require.NoError(t, err)
		require.Equal(t, tc.milliseconds+7200000, policy.LegacyDeadline().UnixMilli())
	}
	for _, value := range []string{"unix-ms:NaN", "unix-ms:8640000000000001", "unix-ms:-8640000000000001", "unix-ms:1.5", "unix-ms:", "unix-ms:99999999999999999999999"} {
		_, err := ParseIdentityTokenPolicy("2h", value)
		require.Error(t, err)
	}
	policy, err := ParseIdentityTokenPolicy("1s", "unix-ms:-62135596801000")
	require.NoError(t, err)
	require.True(t, policy.Valid(), "the year-one deadline is distinct from unconfigured policy")
	require.True(t, policy.LegacyDeadline().IsZero())
}

func TestLoadConfig_IdentityLifetimeDefaultsAndOverrides(t *testing.T) {
	setIdentityPolicyConfigFixture(t)
	t.Setenv("MAX_MACHINE_IDENTITY_TOKEN_AGE", "")
	t.Setenv("LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT", "")
	cfg, err := LoadConfig()
	require.NoError(t, err)
	require.Equal(t, 90*24*time.Hour, cfg.IdentityTokenPolicy.MaxAge())
	t.Setenv("MAX_MACHINE_IDENTITY_TOKEN_AGE", " 2h ")
	t.Setenv("LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT", "2026-01-01T00:00:00Z")
	cfg, err = LoadConfig()
	require.NoError(t, err)
	require.Equal(t, 2*time.Hour, cfg.IdentityTokenPolicy.MaxAge())
	require.Equal(t, time.Date(2026, 1, 1, 2, 0, 0, 0, time.UTC), cfg.IdentityTokenPolicy.LegacyDeadline())
}

func TestLoadConfig_InvalidIdentityLifetimePolicy(t *testing.T) {
	setIdentityPolicyConfigFixture(t)
	_, err := LoadConfig()
	require.NoError(t, err, "ordinary fixture configuration must load")
	for _, value := range []string{"nonsense", "0", "-1s", "500ms", "999999999999999999years", "1h30m", "1e3s"} {
		t.Run("maximum-age-"+value, func(t *testing.T) {
			t.Setenv("MAX_MACHINE_IDENTITY_TOKEN_AGE", value)
			_, err := LoadConfig()
			require.Error(t, err, "invalid identity lifetime must not silently become an authentication policy")
		})
	}
	for _, value := range []string{"not-a-date", "2026-99-99T00:00:00Z", "2026-05-04T00:00:00+24:00", "2026-05-04T00:00:00+00:60", "2026-05-04T00:00:00,123Z", "2026-05-04T00:00:00"} {
		t.Run("enforcement-date-"+value, func(t *testing.T) {
			t.Setenv("LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT", value)
			_, err := LoadConfig()
			require.Error(t, err, "invalid identity enforcement date must stop startup")
		})
	}
}
