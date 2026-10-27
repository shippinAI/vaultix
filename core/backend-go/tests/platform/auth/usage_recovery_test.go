//go:build integration

package auth_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/tests/infra"
)

// Synchronize only the target counter reads. All cache commands still use the
// real provider; cancellation prevents a preceding authentication failure from
// leaving the other requests waiting indefinitely.
type usageReadBarrier struct {
	keystore.KeyStore
	key       string
	remaining atomic.Int32
	ready     chan struct{}
}

func (b *usageReadBarrier) GetItem(ctx context.Context, key string) (string, error) {
	value, err := b.KeyStore.GetItem(ctx, key)
	if key != b.key {
		return value, err
	}
	if b.remaining.Add(-1) == 0 {
		close(b.ready)
	}
	select {
	case <-b.ready:
		return value, err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func TestIdentityUsageBudgetSharedWithCoreAPI(t *testing.T) {
	node := stack.NodeJS()
	identity := node.CreateIdentity(t, "usage-budget-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	path := "/api/v1/auth/universal-auth/identities/" + identity.ID
	var method infra.CreateUniversalAuthResponse
	r, err := node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateUniversalAuthRequest{
		IdentityID: identity.ID, AccessTokenTTL: 3600, AccessTokenMaxTTL: 7200,
		AccessTokenNumUsesLimit: 5,
		AccessTokenTrustedIPs:   []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
		ClientSecretTrustedIPs:  []infra.IPAddress{{IPAddress: "0.0.0.0/0"}},
	}).SetResult(&method).Post(path)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	var secret infra.CreateClientSecretResponse
	r, err = node.Client().R().SetAuthToken(node.IdentityToken()).SetBody(infra.CreateClientSecretRequest{
		Description: "usage-budget-fixture",
	}).SetResult(&secret).Post(path + "/client-secrets")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	var login infra.UniversalAuthLoginResponse
	r, err = node.Client().R().SetBody(infra.UniversalAuthLoginRequest{
		ClientID: method.IdentityUniversalAuth.ClientID, ClientSecret: secret.ClientSecret,
	}).SetResult(&login).Post("/api/v1/auth/universal-auth/login")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, r.StatusCode())
	require.NotEmpty(t, login.AccessToken)

	// Use the API-issued credential unchanged, including signature and claims.
	claims := &apiauth.IdentityJWTClaims{}
	_, err = jwt.ParseWithClaims(login.AccessToken, claims, func(_ *jwt.Token) (any, error) {
		return []byte(infra.AuthSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	require.NoError(t, err)
	key := "identity-token-uses-remaining:" + identity.ID + ":" + claims.IdentityAccessTokenID
	client := stack.Redis().Client()
	t.Cleanup(func() { _ = client.Close() })
	store := keystore.NewKeyStore(client)
	apiStatus := func() int {
		t.Helper()
		response, requestErr := node.Client().R().SetAuthToken(login.AccessToken).Get("/api/v1/identities/details")
		require.NoError(t, requestErr)
		return response.StatusCode()
	}
	require.Equal(t, http.StatusOK, apiStatus())
	require.Equal(t, http.StatusOK, apiStatus())

	burst := func(expected int) {
		t.Helper()
		const requests = 24
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		barrier := &usageReadBarrier{KeyStore: store, key: key, ready: make(chan struct{})}
		barrier.remaining.Store(requests)
		validator := apiauth.NewApiAuthenticator(slog.New(slog.NewTextHandler(io.Discard, nil)), stack.DB(), infra.AuthSecret, barrier, nil, infra.NewNopErrorHandler())
		type result struct {
			identity *auth.Identity
			err      error
		}
		results := make(chan result, requests)
		for range requests {
			go func() {
				actor, validationErr := validator.ValidateIdentityAccessToken(ctx, login.AccessToken, "")
				results <- result{identity: actor, err: validationErr}
			}()
		}
		allowed := 0
		for range requests {
			outcome := <-results
			if outcome.err == nil {
				allowed++
				require.Equal(t, identity.ID, outcome.identity.ActorID.String())
			} else {
				var appErr *errutil.Error
				require.ErrorAs(t, outcome.err, &appErr)
				require.Equal(t, http.StatusUnauthorized, appErr.Status)
			}
		}
		require.Equal(t, expected, allowed)
	}
	burst(3)
	require.Equal(t, http.StatusUnauthorized, apiStatus())

	// Existing recovery restores the configured budget after cache loss. This
	// checks competing recovery, not durable accounting across cache eviction.
	require.NoError(t, client.Del(context.Background(), key).Err())
	burst(5)
	require.Equal(t, http.StatusUnauthorized, apiStatus())
}
