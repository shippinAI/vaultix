package apiauth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/libs/errutil"
)

type delegatedProbeDB struct {
	pg.DB
	pool  *pgxpool.Pool
	reads int
}

func (db *delegatedProbeDB) Primary() *pgxpool.Pool { db.reads++; return db.pool }

type delegatedErrorHandler struct{}

func (delegatedErrorHandler) HandleError(w http.ResponseWriter, _ *http.Request, status int, err error) {
	var appErr *errutil.Error
	if errors.As(err, &appErr) {
		status = appErr.Status
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "Authentication refused"})
}

func TestRequireAuth_DelegatedTokenCannotBecomeUserSession(t *testing.T) {
	t.Parallel()
	for _, value := range []string{`"delegated-client"`, `""`, `null`, `false`, `{}`, `[]`} {
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			// A closed pool proves rejection precedes session/authority lookup.
			pool, err := pgxpool.New(t.Context(), "postgres://fixture:fixture@127.0.0.1:1/fixture?sslmode=disable")
			require.NoError(t, err)
			pool.Close()
			db := &delegatedProbeDB{pool: pool}
			const secret = "delegated-auth-unit-fixture"
			validator := &ApiAuthenticator{authSecret: []byte(secret), db: db, errorHandler: delegatedErrorHandler{}}
			claims := jwt.MapClaims{
				"authTokenType": "accessToken", "oauthClientId": json.RawMessage(value),
				"scopes": []string{}, "exp": time.Now().Add(time.Hour).Unix(),
			}
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
			require.NoError(t, err)
			for _, mode := range []AuthMode{JWTAuth, IdentityAccessTokenAuth} {
				called := false
				handler := validator.RequireAuth(WithAuthModes(mode))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					called = true
					w.WriteHeader(http.StatusNoContent)
				}))
				request := httptest.NewRequest(http.MethodGet, "/protected", http.NoBody)
				request.Header.Set("Authorization", "Bearer "+token)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				require.Equal(t, http.StatusUnauthorized, response.Code)
				require.False(t, called)
				require.Zero(t, db.reads)
				require.NotContains(t, response.Body.String(), token)
			}
			identity, err := validator.ValidateJWT(context.Background(), token)
			require.Nil(t, identity)
			var appErr *errutil.Error
			require.ErrorAs(t, err, &appErr)
			require.Equal(t, http.StatusUnauthorized, appErr.Status)
			require.Zero(t, db.reads)
		})
	}
}
