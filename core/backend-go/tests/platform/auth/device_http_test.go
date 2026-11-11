//go:build integration

package auth_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix-cloud/api/internal/server/api/platform/deviceauth"
	"github.com/vaultix-cloud/api/internal/services/auth/apiauth"
)

func deviceHTTP(t *testing.T) (*sessionFixture, *apiauth.ApiAuthenticator, string) {
	t.Helper()
	f, a, _ := deviceConsumer(t)
	cache := stack.Redis().Client()
	t.Cleanup(func() { require.NoError(t, cache.Close()) })
	h, err := deviceauth.NewHandler(&deviceauth.Deps{Grants: f.grant.service, Sessions: f.sessions, Limiter: &deviceauth.RedisLimiter{Client: cache, Resource: deviceRequest().Resource}, Resource: deviceRequest().Resource, BrowserAuth: a.RequireAuth(apiauth.WithAuthModes(apiauth.JWTAuth))})
	require.NoError(t, err)
	router := chi.NewRouter()
	h.Register(router)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return f, a, server.URL
}

func deviceForm() url.Values {
	r := deviceRequest()
	return url.Values{"client_id": {r.ClientID}, "resource": {r.Resource}, "scope": {r.Scope}}
}

func deviceHTTPPost(t *testing.T, base, path, token, origin string, values url.Values, status int) map[string]json.RawMessage {
	t.Helper()
	r, err := http.NewRequestWithContext(t.Context(), http.MethodPost, base+deviceauth.Path+path, strings.NewReader(values.Encode()))
	require.NoError(t, err)
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	response, err := http.DefaultClient.Do(r)
	require.NoError(t, err)
	defer response.Body.Close()
	// Never put a credential-bearing response into a failed assertion message.
	require.Equal(t, status, response.StatusCode)
	require.Equal(t, "no-store", response.Header.Get("Cache-Control"))
	body, err := io.ReadAll(io.LimitReader(response.Body, 16384))
	require.NoError(t, err)
	var result map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(body, &result))
	return result
}

func deviceField(t *testing.T, body map[string]json.RawMessage, name string) string {
	t.Helper()
	var value string
	require.NoError(t, json.Unmarshal(body[name], &value))
	return value
}

func TestDeviceHTTP_RealBrowserGrantRenewalAndRevocation(t *testing.T) {
	f, a, base := deviceHTTP(t)
	browser := stack.NodeJS().UserToken()
	origin := deviceRequest().Resource
	started := deviceHTTPPost(t, base, "/authorize", "", "", deviceForm(), 200)
	code := deviceField(t, started, "user_code")
	secret := deviceField(t, started, "device_code")
	info, err := f.grant.service.Inspect(t.Context(), code)
	require.NoError(t, err)
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": info.ID})
	})
	review := url.Values{"user_code": {code}}
	deviceHTTPPost(t, base, "/inspect", "", origin, review, 401)
	deviceHTTPPost(t, base, "/inspect", stack.NodeJS().IdentityToken(), origin, review, 401)
	deviceHTTPPost(t, base, "/inspect", browser, "https://attacker.invalid", review, 403)
	visible := deviceHTTPPost(t, base, "/inspect", browser, origin, review, 200)
	require.Equal(t, "Vaultix CLI", deviceField(t, visible, "client_name"))
	require.NotContains(t, visible, "device_code")
	require.NotContains(t, visible, "access_token")
	poll := deviceForm()
	poll.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	poll.Set("device_code", secret)
	early := deviceHTTPPost(t, base, "/token", "", "", poll, 400)
	require.Equal(t, "slow_down", deviceField(t, early, "error"))
	review.Set("decision", "approve")
	deviceHTTPPost(t, base, "/decision", browser, origin, review, 200)
	// Observe the actual increased polling delay, rather than altering the row.
	time.Sleep(10 * time.Second)
	issued := deviceHTTPPost(t, base, "/token", "", "", poll, 200)
	access := deviceField(t, issued, "access_token")
	refresh := deviceField(t, issued, "refresh_token")
	actor, err := a.ValidateDeviceAccess(t.Context(), access)
	require.NoError(t, err)
	require.Equal(t, stack.NodeJS().UserID(), actor.ActorID.String())
	require.Equal(t, stack.NodeJS().OrgID(), actor.OrgID.String())
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM auth_token_sessions WHERE id=@id`, pgx.NamedArgs{"id": actor.TokenVersionID})
		devicePolicyExec(t, `DELETE FROM vaultix_device_session_events WHERE "sessionId"=@id`, pgx.NamedArgs{"id": actor.TokenVersionID})
	})
	deviceHTTPPost(t, base, "/decision", access, origin, review, 401)
	replayed := deviceHTTPPost(t, base, "/token", "", "", poll, 400)
	require.Equal(t, "invalid_grant", deviceField(t, replayed, "error"))
	renew := deviceForm()
	renew.Set("grant_type", "refresh_token")
	renew.Set("refresh_token", refresh)
	rotated := deviceHTTPPost(t, base, "/token", "", "", renew, 200)
	newRefresh := deviceField(t, rotated, "refresh_token")
	require.True(t, refresh != newRefresh, "refresh rotation must replace the credential")
	revoke := deviceForm()
	revoke.Set("token", newRefresh)
	deviceHTTPPost(t, base, "/revoke", "", "", revoke, 200)
	_, err = a.ValidateDeviceAccess(t.Context(), deviceField(t, rotated, "access_token"))
	require.Error(t, err)
	deviceHTTPPost(t, base, "/token", "", "", renew, 400)
	_, err = a.ValidateJWT(t.Context(), browser)
	require.NoError(t, err)
	require.NotContains(t, f.grant.logs.String(), secret)
	require.NotContains(t, f.grant.logs.String(), access)
	require.NotContains(t, f.grant.logs.String(), refresh)
}

func TestDeviceHTTP_CancellationAndDeniedApproval(t *testing.T) {
	f, _, base := deviceHTTP(t)
	for _, outcome := range []string{"cancel", "deny", "locked"} {
		t.Run(outcome, func(t *testing.T) {
			_, actor := newReauthenticationAccount(t)
			browser := signUserJWT(t, stack.Config().AuthSecret, func(c *apiauth.UserJWTClaims) {
				c.UserID = actor.ActorID
				c.TokenVersionID = actor.TokenVersionID
				c.OrganizationID = actor.OrgID
				c.AuthMethod = "email"
			})
			started := deviceHTTPPost(t, base, "/authorize", "", "", deviceForm(), 200)
			code := deviceField(t, started, "user_code")
			secret := deviceField(t, started, "device_code")
			info, err := f.grant.service.Inspect(context.Background(), code)
			require.NoError(t, err)
			t.Cleanup(func() {
				devicePolicyExec(t, `DELETE FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": info.ID})
			})
			switch outcome {
			case "cancel":
				v := deviceForm()
				v.Set("device_code", secret)
				deviceHTTPPost(t, base, "/cancel", "", "", v, 200)
			case "deny":
				deviceHTTPPost(t, base, "/decision", browser, deviceRequest().Resource, url.Values{"user_code": {code}, "decision": {"deny"}}, 200)
			case "locked":
				devicePolicyExec(t, `UPDATE users SET "isLocked"=true WHERE id=@id`, pgx.NamedArgs{"id": actor.ActorID})
				deviceHTTPPost(t, base, "/decision", browser, deviceRequest().Resource, url.Values{"user_code": {code}, "decision": {"approve"}}, 401)
				return
			}
			poll := deviceForm()
			poll.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
			poll.Set("device_code", secret)
			denied := deviceHTTPPost(t, base, "/token", "", "", poll, 400)
			require.Equal(t, "access_denied", deviceField(t, denied, "error"))
		})
	}
}

func TestDeviceHTTP_RefreshReuseRevokesIssuedSession(t *testing.T) {
	f, a, base := deviceHTTP(t)
	started := deviceHTTPPost(t, base, "/authorize", "", "", deviceForm(), 200)
	code := deviceField(t, started, "user_code")
	info, err := f.grant.service.Inspect(t.Context(), code)
	require.NoError(t, err)
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": info.ID})
	})
	deviceHTTPPost(t, base, "/decision", stack.NodeJS().UserToken(), deviceRequest().Resource, url.Values{"user_code": {code}, "decision": {"approve"}}, 200)
	time.Sleep(5 * time.Second)
	poll := deviceForm()
	poll.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	poll.Set("device_code", deviceField(t, started, "device_code"))
	issued := deviceHTTPPost(t, base, "/token", "", "", poll, 200)
	actor, err := a.ValidateDeviceAccess(t.Context(), deviceField(t, issued, "access_token"))
	require.NoError(t, err)
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM auth_token_sessions WHERE id=@id`, pgx.NamedArgs{"id": actor.TokenVersionID})
		devicePolicyExec(t, `DELETE FROM vaultix_device_session_events WHERE "sessionId"=@id`, pgx.NamedArgs{"id": actor.TokenVersionID})
	})
	renew := deviceForm()
	renew.Set("grant_type", "refresh_token")
	renew.Set("refresh_token", deviceField(t, issued, "refresh_token"))
	rotated := deviceHTTPPost(t, base, "/token", "", "", renew, 200)
	reused := deviceHTTPPost(t, base, "/token", "", "", renew, 400)
	require.Equal(t, "invalid_grant", deviceField(t, reused, "error"))
	_, err = a.ValidateDeviceAccess(t.Context(), deviceField(t, rotated, "access_token"))
	require.Error(t, err)
	var reason string
	require.NoError(t, stack.DB().Primary().QueryRow(t.Context(), `SELECT action FROM vaultix_device_session_events WHERE "sessionId"=@id AND action='reuse'`, pgx.NamedArgs{"id": actor.TokenVersionID}).Scan(&reason))
	require.Equal(t, "reuse", reason)
}
