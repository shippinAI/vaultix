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

func TestValidateIdentityAccessToken_RealClientSecretRevocation(t *testing.T) {
	node := stack.NodeJS()
	identity := node.CreateIdentity(t, "scoped-revocation-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	path := "/api/v1/auth/universal-auth/identities/" + identity.ID
	var method infra.CreateUniversalAuthResponse
	r, err := node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateUniversalAuthRequest{
		IdentityID: identity.ID, AccessTokenTTL: 3600, AccessTokenMaxTTL: 7200,
		AccessTokenTrustedIPs:  []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
		ClientSecretTrustedIPs: []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
	}).SetResult(&method).Post(path)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())

	tokens := make([]string, 2)
	secretIDs := make([]string, 2)
	for i := range tokens {
		var secret infra.CreateClientSecretResponse
		r, err = node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateClientSecretRequest{
			Description: "scoped-revocation-fixture",
		}).SetResult(&secret).Post(path + "/client-secrets")
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, r.StatusCode())
		secretIDs[i] = secret.ClientSecretData.ID
		require.NotEmpty(t, secretIDs[i])
		var login infra.UniversalAuthLoginResponse
		r, err = node.Client().R().SetBody(infra.UniversalAuthLoginRequest{
			ClientID: method.IdentityUniversalAuth.ClientID, ClientSecret: secret.ClientSecret,
		}).SetResult(&login).Post("/api/v1/auth/universal-auth/login")
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, r.StatusCode())
		tokens[i] = login.AccessToken
		r, err = node.Client().R().SetAuthToken(tokens[i]).Get("/api/v1/identities/details")
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, r.StatusCode())
		actor, validateErr := authenticator.ValidateIdentityAccessToken(context.Background(), tokens[i], "")
		require.NoError(t, validateErr)
		require.Equal(t, identity.ID, actor.ActorID.String())
	}

	// This is the real authorized lifecycle endpoint, not a manufactured DB marker.
	r, err = node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(struct{}{}).
		Post(path + "/client-secrets/" + secretIDs[0] + "/revoke")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	t.Run("HTTP_denies_revoked_secret", func(t *testing.T) {
		r, err := node.Client().R().SetAuthToken(tokens[0]).Get("/api/v1/identities/details")
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, r.StatusCode())
	})
	t.Run("native_denies_revoked_secret", func(t *testing.T) {
		_, err := authenticator.ValidateIdentityAccessToken(context.Background(), tokens[0], "")
		require.ErrorContains(t, err, "client secret has been revoked")
		assertUnauthorized(t, err)
	})
	t.Run("unified_denies_revoked_secret", func(t *testing.T) {
		_, _, err := authenticator.ValidateJWTToken(context.Background(), tokens[0], "")
		require.ErrorContains(t, err, "client secret has been revoked")
		assertUnauthorized(t, err)
	})
	t.Run("other_secret_remains_valid", func(t *testing.T) {
		r, err := node.Client().R().SetAuthToken(tokens[1]).Get("/api/v1/identities/details")
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, r.StatusCode())
		actor, err := authenticator.ValidateIdentityAccessToken(context.Background(), tokens[1], "")
		require.NoError(t, err)
		require.Equal(t, identity.ID, actor.ActorID.String())
		actor, _, err = authenticator.ValidateJWTToken(context.Background(), tokens[1], "")
		require.NoError(t, err)
		require.Equal(t, identity.ID, actor.ActorID.String())
	})
}

// These signed payloads and DB markers characterize historical/current formats
// and marker boundaries. They are separate from the real API lifecycle above.
func TestValidateIdentityAccessToken_ScopedMarkerFixtures(t *testing.T) {
	node := stack.NodeJS()
	identity := node.CreateIdentity(t, "marker-fixtures-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	for _, format := range []string{"complete", "legacy"} {
		t.Run(format, func(t *testing.T) {
			clientSecretID := uuid.NewString()
			for _, tc := range []struct {
				name, scope, reason                                     string
				tokenIDMarker, identityIDMarker, expired, otherIdentity bool
				nullScope                                               bool
				boundary                                                time.Duration
			}{
				{name: "client-secret", scope: clientSecretID, reason: "client secret has been revoked", boundary: time.Millisecond},
				{name: "method", scope: "universal-auth", reason: "auth method has been revoked", boundary: time.Millisecond},
				{name: "organization", scope: node.OrgID(), reason: "Identity is not a member of the organization", boundary: time.Millisecond},
				{name: "equal-time", scope: clientSecretID},
				{name: "issued-after", scope: clientSecretID, boundary: -time.Millisecond},
				{name: "expired-marker", scope: clientSecretID, expired: true, boundary: time.Millisecond},
				{name: "other-identity-scope", scope: clientSecretID, otherIdentity: true, boundary: time.Millisecond},
				{name: "other-identity-token-id", nullScope: true, tokenIDMarker: true, otherIdentity: true},
				{name: "empty-scope-token-id", tokenIDMarker: true, boundary: time.Millisecond},
				{name: "scope-token-id-equal-time", scope: clientSecretID, tokenIDMarker: true},
				{name: "scope-token-id-before-time", scope: clientSecretID, tokenIDMarker: true, reason: "client secret has been revoked", boundary: time.Millisecond},
				{name: "unrelated-scope-token-id", scope: uuid.NewString(), tokenIDMarker: true, boundary: time.Millisecond},
				{name: "null-scope-token-id", nullScope: true, tokenIDMarker: true, reason: "token has been revoked", boundary: -time.Millisecond},
				{name: "identity-wide", nullScope: true, identityIDMarker: true, reason: "identity tokens have been revoked", boundary: time.Millisecond},
				{name: "identity-wide-equal-time", nullScope: true, identityIDMarker: true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					ctx := context.Background()
					tokenID := uuid.NewString()
					issuedAt := time.Now().Add(-10 * time.Second).Truncate(time.Second)
					claims := jwt.MapClaims{
						"authTokenType": auth.AuthTokenTypeIdentityAccessToken,
						"identityId":    identity.ID, "identityAccessTokenId": tokenID,
						"clientSecretId": clientSecretID,
						"iat":            issuedAt.Unix(), "exp": time.Now().Add(time.Hour).Unix(),
					}
					if format == "complete" {
						for key, value := range (jwt.MapClaims{
							"jti": tokenID, "orgId": node.OrgID(), "rootOrgId": node.OrgID(), "parentOrgId": node.OrgID(),
							"authMethod": "universal-auth", "accessTokenTTL": 3600, "accessTokenMaxTTL": 7200,
							"accessTokenPeriod": 0, "creationEpoch": issuedAt.Unix(),
						}) {
							claims[key] = value
						}
					} else {
						_, err := stack.DB().Primary().Exec(ctx, `
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
					}
					token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(infra.AuthSecret))
					require.NoError(t, err)
					_, err = authenticator.ValidateIdentityAccessToken(ctx, token, "")
					require.NoError(t, err, "fixture must be valid before adding a marker")
					markerID := uuid.NewString()
					if tc.tokenIDMarker {
						markerID = tokenID
					}
					if tc.identityIDMarker {
						markerID = identity.ID
					}
					markerIdentity := identity.ID
					if tc.otherIdentity {
						markerIdentity = uuid.NewString()
					}
					var scope any = tc.scope
					if tc.nullScope {
						scope = nil
					}
					expiresAt := time.Now().Add(time.Hour)
					if tc.expired {
						expiresAt = time.Now().Add(-time.Minute)
					}
					_, err = stack.DB().Primary().Exec(ctx, `
						INSERT INTO identity_access_token_revocations (id, "identityId", scope, "revokedAt", "expiresAt")
						VALUES (@id, @identityID, @scope, @revokedAt, @expiresAt)
					`, pgx.NamedArgs{"id": markerID, "identityID": markerIdentity, "scope": scope,
						"revokedAt": issuedAt.Add(tc.boundary), "expiresAt": expiresAt})
					require.NoError(t, err)
					t.Cleanup(func() {
						_, err := stack.DB().Primary().Exec(ctx, `DELETE FROM identity_access_token_revocations WHERE id = $1`, markerID)
						require.NoError(t, err)
					})
					_, err = authenticator.ValidateIdentityAccessToken(ctx, token, "")
					_, _, unifiedErr := authenticator.ValidateJWTToken(ctx, token, "")
					if tc.reason != "" {
						require.ErrorContains(t, err, tc.reason)
						require.ErrorContains(t, unifiedErr, tc.reason)
						assertUnauthorized(t, err)
						assertUnauthorized(t, unifiedErr)
					} else {
						require.NoError(t, err)
						require.NoError(t, unifiedErr)
					}
				})
			}
		})
	}
}
