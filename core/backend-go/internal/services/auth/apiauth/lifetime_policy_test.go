package apiauth

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/config"
)

func testIdentityPolicy(t *testing.T) config.IdentityTokenPolicy {
	t.Helper()
	policy, err := config.ParseIdentityTokenPolicy("2h", "2026-01-01T00:00:00.123Z")
	require.NoError(t, err)
	return policy
}

func TestValidateIdentityLifetime_GraceBoundary(t *testing.T) {
	t.Parallel()
	policy := testIdentityPolicy(t)
	a := &ApiAuthenticator{identityPolicy: policy}
	for _, tc := range []struct {
		name   string
		delta  time.Duration
		denied bool
	}{
		{"before", -time.Millisecond, false}, {"at", 0, false},
		{"same_millisecond", time.Microsecond, false}, {"after", time.Millisecond, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := a.validateIdentityLifetime(&IdentityJWTClaims{}, policy.LegacyDeadline().Add(tc.delta))
			if tc.denied {
				require.ErrorContains(t, err, "exceeded max age")
			} else {
				require.NoError(t, err)
			}
		})
	}
	// Expiring credentials remain subject to the JWT parser's normal expiry;
	// this deployment-anchored grace applies only to missing/null exp claims.
	claims := &IdentityJWTClaims{RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(policy.LegacyDeadline().Add(time.Hour))}}
	require.NoError(t, a.validateIdentityLifetime(claims, policy.LegacyDeadline().Add(time.Minute)))
}

func TestNewApiAuthenticator_RequiresLifetimePolicy(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, deps := range []*AuthenticatorDeps{nil, {}} {
		a, err := NewApiAuthenticator(context.Background(), logger, deps)
		require.ErrorContains(t, err, "lifetime policy is required")
		require.Nil(t, a)
	}
	_, err := NewApiAuthenticator(context.Background(), logger, &AuthenticatorDeps{DB: nil, AuthSecret: "", KeyStore: nil, AssumePrivilege: nil, ErrorHandler: nil, IdentityPolicy: testIdentityPolicy(t)})
	require.NoError(t, err)
	a := &ApiAuthenticator{}
	require.ErrorContains(t, a.validateIdentityLifetime(&IdentityJWTClaims{}, time.Now()), "policy is unavailable")
}
