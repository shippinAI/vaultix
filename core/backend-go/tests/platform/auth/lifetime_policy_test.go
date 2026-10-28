//go:build integration

package auth_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/tests/infra"
)

func TestIdentityUsageCounter_RetentionMatchesIssuer(t *testing.T) {
	node := stack.NodeJS()
	identity := node.CreateIdentity(t, "retention-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	path := "/api/v1/auth/universal-auth/identities/" + identity.ID
	var method infra.CreateUniversalAuthResponse
	r, err := node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateUniversalAuthRequest{
		IdentityID: identity.ID, AccessTokenTTL: 0, AccessTokenMaxTTL: 0,
		AccessTokenNumUsesLimit: 3,
		AccessTokenTrustedIPs:   []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
		ClientSecretTrustedIPs:  []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
	}).SetResult(&method).Post(path)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	var secret infra.CreateClientSecretResponse
	r, err = node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateClientSecretRequest{
		Description: "retention-fixture",
	}).SetResult(&secret).Post(path + "/client-secrets")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	var login infra.UniversalAuthLoginResponse
	r, err = node.Client().R().SetBody(infra.UniversalAuthLoginRequest{
		ClientID: method.IdentityUniversalAuth.ClientID, ClientSecret: secret.ClientSecret,
	}).SetResult(&login).Post("/api/v1/auth/universal-auth/login")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	claims := &apiauth.IdentityJWTClaims{}
	_, err = jwt.ParseWithClaims(login.AccessToken, claims, func(_ *jwt.Token) (any, error) {
		return []byte(infra.AuthSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	require.NoError(t, err)
	key := "identity-token-uses-remaining:" + identity.ID + ":" + claims.IdentityAccessTokenID
	client := stack.Redis().Client()
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()
	issuerTTL, err := client.TTL(ctx, key).Result()
	require.NoError(t, err)
	require.Positive(t, issuerTTL)
	require.NotNil(t, claims.ExpiresAt)
	require.InDelta(t, issuerTTL.Seconds(), time.Until(claims.ExpiresAt.Time).Seconds(), 5,
		"zero configured budgets issue a real token bounded by the same maximum-age policy")
	require.NoError(t, client.Del(ctx, key).Err())
	validator, err := apiauth.NewApiAuthenticator(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), &apiauth.AuthenticatorDeps{
		DB: stack.DB(), AuthSecret: infra.AuthSecret, KeyStore: keystore.NewKeyStore(client), AssumePrivilege: nil, ErrorHandler: infra.NewNopErrorHandler(), IdentityPolicy: stack.Config().IdentityTokenPolicy,
	})
	require.NoError(t, err)
	_, err = validator.ValidateIdentityAccessToken(ctx, login.AccessToken, "")
	require.NoError(t, err)
	nativeTTL, err := client.TTL(ctx, key).Result()
	require.NoError(t, err)
	t.Logf("issuer_retention_seconds=%d native_retention_seconds=%d", int64(issuerTTL.Seconds()), int64(nativeTTL.Seconds()))
	t.Run("native_retention_matches_issuer", func(t *testing.T) {
		// Recovery starts a new window; allow the few seconds spent on the request.
		require.InDelta(t, issuerTTL.Seconds(), nativeTTL.Seconds(), 5)
	})
	t.Run("recovery_consumes_one_use", func(t *testing.T) {
		remaining, err := client.Get(ctx, key).Result()
		require.NoError(t, err)
		require.Equal(t, "2", remaining)
		r, err := node.Client().R().SetAuthToken(login.AccessToken).Get("/api/v1/identities/details")
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, r.StatusCode())
		remaining, err = client.Get(ctx, key).Result()
		require.NoError(t, err)
		require.Equal(t, "1", remaining)
	})
}

func TestValidateIdentityAccessToken_LegacyExpirationGrace(t *testing.T) {
	require.Equal(t, 2*time.Hour, stack.Config().IdentityTokenPolicy.MaxAge())
	require.True(t, time.Now().After(stack.Config().IdentityTokenPolicy.LegacyDeadline()))
	node := stack.NodeJS()
	identity := node.CreateIdentity(t, "legacy-grace-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	r, err := node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateUniversalAuthRequest{
		IdentityID: identity.ID, AccessTokenTTL: 3600, AccessTokenMaxTTL: 7200,
		AccessTokenTrustedIPs:  []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
		ClientSecretTrustedIPs: []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
	}).Post("/api/v1/auth/universal-auth/identities/" + identity.ID)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	tokenID := uuid.NewString()
	ctx := context.Background()
	_, err = stack.DB().Primary().Exec(ctx, `
		INSERT INTO identity_access_tokens (
			id, "identityId", "isAccessTokenRevoked", "accessTokenTTL", "accessTokenMaxTTL",
			"accessTokenNumUses", "accessTokenNumUsesLimit", "authMethod", "createdAt", "updatedAt"
		) VALUES (@tokenID, @identityID, false, 3600, 7200, 0, 0, 'universal-auth', NOW(), NOW())
	`, pgx.NamedArgs{"tokenID": tokenID, "identityID": identity.ID})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(ctx, `DELETE FROM identity_access_tokens WHERE id = $1`, tokenID)
		require.NoError(t, err)
	})
	claims := jwt.MapClaims{
		"authTokenType": auth.AuthTokenTypeIdentityAccessToken,
		"identityId":    identity.ID, "identityAccessTokenId": tokenID,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	}
	control, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(infra.AuthSecret))
	require.NoError(t, err)
	r, err = node.Client().R().SetAuthToken(control).Get("/api/v1/identities/details")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	_, err = authenticator.ValidateIdentityAccessToken(ctx, control, "")
	require.NoError(t, err)
	delete(claims, "exp")
	historical, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(infra.AuthSecret))
	require.NoError(t, err)
	t.Run("HTTP_denies_elapsed_grace", func(t *testing.T) {
		r, err := node.Client().R().SetAuthToken(historical).Get("/api/v1/identities/details")
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, r.StatusCode())
	})
	t.Run("native_denies_elapsed_grace", func(t *testing.T) {
		_, err := authenticator.ValidateIdentityAccessToken(ctx, historical, "")
		t.Logf("native_missing_exp_allowed=%t", err == nil)
		require.ErrorContains(t, err, "exceeded max age")
		assertUnauthorized(t, err)
	})
	t.Run("unified_denies_elapsed_grace", func(t *testing.T) {
		_, _, err := authenticator.ValidateJWTToken(ctx, historical, "")
		require.ErrorContains(t, err, "exceeded max age")
		assertUnauthorized(t, err)
	})
}
