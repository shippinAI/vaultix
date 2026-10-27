//go:build integration

package auth_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/tests/infra"
)

func TestValidateIdentityAccessToken_ExplicitZeroLifetimeClaims(t *testing.T) {
	node := stack.NodeJS()
	identity := node.CreateIdentity(t, "zero-lifetime-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	path := "/api/v1/auth/universal-auth/identities/" + identity.ID
	var method infra.CreateUniversalAuthResponse
	r, err := node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateUniversalAuthRequest{
		IdentityID: identity.ID, AccessTokenTTL: 0, AccessTokenMaxTTL: 0,
		AccessTokenTrustedIPs:  []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
		ClientSecretTrustedIPs: []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
	}).SetResult(&method).Post(path)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	var secret infra.CreateClientSecretResponse
	r, err = node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateClientSecretRequest{
		Description: "zero-lifetime-fixture",
	}).SetResult(&secret).Post(path + "/client-secrets")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	var login infra.UniversalAuthLoginResponse
	r, err = node.Client().R().SetBody(infra.UniversalAuthLoginRequest{
		ClientID: method.IdentityUniversalAuth.ClientID, ClientSecret: secret.ClientSecret,
	}).SetResult(&login).Post("/api/v1/auth/universal-auth/login")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())

	claims := jwt.MapClaims{}
	_, err = jwt.ParseWithClaims(login.AccessToken, claims, func(_ *jwt.Token) (any, error) {
		return []byte(infra.AuthSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	require.NoError(t, err)
	for _, field := range []string{"accessTokenTTL", "accessTokenMaxTTL", "accessTokenPeriod"} {
		require.Equal(t, float64(0), claims[field])
	}
	expiry, err := claims.GetExpirationTime()
	require.NoError(t, err)
	require.NotNil(t, expiry)
	require.True(t, expiry.After(time.Now()), "zero configured budgets still issue an expiring JWT")
	tokenID, ok := claims["jti"].(string)
	require.True(t, ok)
	require.NotEmpty(t, tokenID)

	// Observe lazy persistence. Do not delete a row to manufacture this scenario.
	var rows int
	err = stack.DB().Primary().QueryRow(context.Background(),
		`SELECT count(*) FROM identity_access_tokens WHERE id = $1`, tokenID).Scan(&rows)
	require.NoError(t, err)
	require.Zero(t, rows)
	r, err = node.Client().R().SetAuthToken(login.AccessToken).Get("/api/v1/identities/details")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())

	actor, err := authenticator.ValidateIdentityAccessToken(context.Background(), login.AccessToken, "")
	require.NoError(t, err)
	require.Equal(t, identity.ID, actor.ActorID.String())
	actor, mode, err := authenticator.ValidateJWTToken(context.Background(), login.AccessToken, "")
	require.NoError(t, err)
	require.Equal(t, auth.AuthModeIdentityAccessToken, mode)
	require.Equal(t, identity.ID, actor.ActorID.String())
}

func TestValidateIdentityAccessToken_IncompleteLifetimeClaimsUseLegacyConstraints(t *testing.T) {
	node := stack.NodeJS()
	identity := node.CreateIdentity(t, "partial-lifetime-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	for _, missing := range []string{"accessTokenTTL", "accessTokenMaxTTL", "accessTokenPeriod", "creationEpoch"} {
		t.Run(missing, func(t *testing.T) {
			tokenID := uuid.NewString()
			_, err := stack.DB().Primary().Exec(context.Background(), `
				INSERT INTO identity_access_tokens (
					id, "identityId", "isAccessTokenRevoked", "accessTokenTTL", "accessTokenMaxTTL",
					"accessTokenNumUses", "accessTokenNumUsesLimit", "authMethod", "createdAt", "updatedAt"
				) VALUES (@tokenID, @identityID, true, 3600, 7200, 0, 0, 'universal-auth', NOW(), NOW())
			`, pgx.NamedArgs{"tokenID": tokenID, "identityID": identity.ID})
			require.NoError(t, err)
			t.Cleanup(func() {
				_, _ = stack.DB().Primary().Exec(context.Background(),
					`DELETE FROM identity_access_tokens WHERE id = $1`, tokenID)
			})
			// A signed fixture deliberately models an incomplete historical payload.
			// It must not bypass the legacy row's revocation flag just because some
			// tenant and lifetime fields happen to be present.
			claims := jwt.MapClaims{
				"authTokenType": auth.AuthTokenTypeIdentityAccessToken,
				"identityId":    identity.ID, "identityAccessTokenId": tokenID, "jti": tokenID,
				"orgId": node.OrgID(), "rootOrgId": node.OrgID(), "parentOrgId": node.OrgID(),
				"authMethod": "universal-auth", "accessTokenTTL": 3600, "accessTokenMaxTTL": 0,
				"accessTokenPeriod": 0, "creationEpoch": time.Now().Unix(),
				"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
			}
			delete(claims, missing)
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(infra.AuthSecret))
			require.NoError(t, err)
			_, err = authenticator.ValidateIdentityAccessToken(context.Background(), token, "")
			require.ErrorContains(t, err, "revoked or unknown access token")
		})
	}
}
