//go:build integration

package bootstrap_test

import (
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/tests/infra"
)

var stack *infra.Stack

func TestMain(m *testing.M) {
	stack = infra.New().WithNodeJSApi().MustStart()
	code := m.Run()
	stack.Stop()
	os.Exit(code)
}

// Use only this package's disposable instance. Never log credentials or response
// bodies: a failed bootstrap response may contain credential material.
func TestBootstrapCredentialLifecycle(t *testing.T) {
	api := stack.NodeJS()
	credential := api.IdentityToken()
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(credential, claims, func(_ *jwt.Token) (any, error) {
		return []byte(infra.AuthSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	require.NoError(t, err)
	expires, err := claims.GetExpirationTime()
	require.NoError(t, err)
	issued, err := claims.GetIssuedAt()
	require.NoError(t, err)
	require.NotNil(t, issued)
	require.Positive(t, expires.Unix()-issued.Unix())
	require.LessOrEqual(t, expires.Unix()-issued.Unix(), int64(90*24*60*60))
	require.Equal(t, api.OrgID(), claims["orgId"])
	require.Equal(t, api.OrgID(), claims["rootOrgId"])
	require.Equal(t, api.OrgID(), claims["parentOrgId"])
	require.Equal(t, "token-auth", claims["authMethod"])
	tokenID, ok := claims["jti"].(string)
	require.True(t, ok)
	require.NotEmpty(t, tokenID)
	require.Equal(t, tokenID, claims["identityAccessTokenId"])
	metadataURL := "/api/v1/auth/token-auth/tokens/" + tokenID

	t.Run("managed token and authorized setup", func(t *testing.T) {
		var result struct {
			Token struct {
				ID             string `json:"id"`
				IdentityID     string `json:"identityId"`
				Name           string `json:"name"`
				AccessTokenTTL int64  `json:"accessTokenTTL"`
			} `json:"token"`
		}
		resp, requestErr := api.Client().R().SetAuthToken(credential).SetResult(&result).Get(metadataURL)
		require.NoError(t, requestErr)
		require.Equal(t, 200, resp.StatusCode())
		require.Equal(t, tokenID, result.Token.ID)
		require.Equal(t, claims["identityId"], result.Token.IdentityID)
		require.Equal(t, "Instance Admin Token", result.Token.Name)
		require.Equal(t, expires.Unix()-issued.Unix(), result.Token.AccessTokenTTL)
		api.CreateProject(t, "bootstrap-proof")
	})

	t.Run("already initialized is rejected", func(t *testing.T) {
		resp, requestErr := api.Client().R().SetBody(infra.BootstrapRequest{
			Email: "second-admin@example.com", Password: "testpassword123", Organization: "second-org",
		}).Post("/api/v1/admin/bootstrap")
		require.NoError(t, requestErr)
		require.Equal(t, 400, resp.StatusCode())
	})

	t.Run("expired credential is rejected", func(t *testing.T) {
		// Re-sign only with the isolated fixture's key to exercise server-side expiry
		// without waiting for the production lifetime or changing its configuration.
		expiredClaims := jwt.MapClaims{}
		for key, value := range claims {
			expiredClaims[key] = value
		}
		expiredClaims["exp"] = time.Now().Add(-time.Minute).Unix()
		expired, signErr := jwt.NewWithClaims(jwt.SigningMethodHS256, expiredClaims).SignedString([]byte(infra.AuthSecret))
		require.NoError(t, signErr)
		resp, requestErr := api.Client().R().SetAuthToken(expired).Get(metadataURL)
		require.NoError(t, requestErr)
		// The existing core maps JWT verification failures to HTTP 403.
		require.Equal(t, 403, resp.StatusCode())
	})

	t.Run("revocation denies the original credential", func(t *testing.T) {
		var failure struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		resp, requestErr := api.Client().R().SetAuthToken(api.UserToken()).SetBody(map[string]any{}).SetError(&failure).Post(metadataURL + "/revoke")
		require.NoError(t, requestErr)
		require.Equal(t, 200, resp.StatusCode(), "revocation error: %s (%s)", failure.Error, failure.Message)
		resp, requestErr = api.Client().R().SetAuthToken(credential).Get(metadataURL)
		require.NoError(t, requestErr)
		require.Equal(t, 401, resp.StatusCode())
	})
}
