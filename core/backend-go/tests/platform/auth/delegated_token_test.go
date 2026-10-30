//go:build integration

package auth_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/server/api/shared"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/tests/infra"
)

func TestDelegatedToken_HTTPBoundaryPreservesFirstPartyAuthority(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	validator, err := apiauth.NewApiAuthenticator(t.Context(), logger, &apiauth.AuthenticatorDeps{
		DB: stack.DB(), AuthSecret: infra.AuthSecret, KeyStore: keystore.NewMemoryKeyStore(),
		ErrorHandler: shared.NewErrorHandler(logger), IdentityPolicy: stack.Config().IdentityTokenPolicy,
		AssumePrivilege: nil,
	})
	require.NoError(t, err)
	firstParty := stack.NodeJS().UserToken()
	var claims jwt.MapClaims
	_, err = jwt.ParseWithClaims(firstParty, &claims, func(_ *jwt.Token) (any, error) { return []byte(infra.AuthSecret), nil }, jwt.WithValidMethods([]string{"HS256"}))
	require.NoError(t, err)
	claimed := 0
	handler := validator.RequireAuth(apiauth.WithAuthModes(apiauth.JWTAuth), apiauth.WithAssumePrivilege(false))(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			actor, authErr := auth.IdentityFromContext(r.Context())
			require.NoError(t, authErr)
			require.Equal(t, stack.NodeJS().UserID(), actor.ActorID.String())
			require.Equal(t, stack.NodeJS().OrgID(), actor.OrgID.String())
			claimed++
			w.WriteHeader(http.StatusNoContent)
		}),
	)
	request := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/protected", http.NoBody)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	require.Equal(t, http.StatusNoContent, request(firstParty).Code)
	for _, scopes := range [][]string{nil, {}, {"secrets:read"}, {"*"}} {
		delegated := jwt.MapClaims{}
		for key, value := range claims {
			delegated[key] = value
		}
		delegated["oauthClientId"] = "delegated-client-fixture"
		delegated["scopes"] = scopes
		token, signErr := jwt.NewWithClaims(jwt.SigningMethodHS256, delegated).SignedString([]byte(infra.AuthSecret))
		require.NoError(t, signErr)
		response := request(token)
		require.Equal(t, http.StatusUnauthorized, response.Code)
		var body map[string]any
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		errorText, ok := body["error"].(string)
		require.True(t, ok)
		require.NotEmpty(t, errorText)
		require.NotContains(t, response.Body.String(), token)
	}
	require.Equal(t, 1, claimed)
	// A rejected delegated token must not revoke or corrupt the original session.
	require.Equal(t, http.StatusNoContent, request(firstParty).Code)
	require.Equal(t, 2, claimed)
}
