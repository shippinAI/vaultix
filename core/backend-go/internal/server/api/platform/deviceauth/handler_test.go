package deviceauth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/device"
)

type fixtureOwner struct {
	calls int
	err   error
}

func (f *fixtureOwner) Start(_ context.Context, r device.Request) (device.Grant, error) {
	f.calls++
	if r.ClientID != device.ClientID || r.Resource != "https://vaultix.test" || r.Scope != device.Scope {
		return device.Grant{}, device.ErrInvalidRequest
	}
	return device.Grant{DeviceCode: "private-device-code", UserCode: "ABCDE-FGHJK", ExpiresAt: time.Now().Add(time.Minute), Interval: 5 * time.Second}, f.err
}
func (f *fixtureOwner) Inspect(context.Context, string) (device.Info, error) {
	f.calls++
	return device.Info{ClientName: "Vaultix CLI", Resource: "https://vaultix.test", Scope: device.Scope}, f.err
}
func (f *fixtureOwner) Approve(context.Context, string, *auth.Identity) error {
	f.calls++
	return f.err
}
func (f *fixtureOwner) Deny(context.Context, string) error                   { f.calls++; return f.err }
func (f *fixtureOwner) Cancel(context.Context, device.Request, string) error { f.calls++; return f.err }
func (f *fixtureOwner) Poll(context.Context, device.Request, string) (device.Session, error) {
	f.calls++
	return device.Session{AccessToken: "private-access", RefreshToken: "private-refresh", ExpiresIn: time.Minute}, f.err
}
func (f *fixtureOwner) Renew(ctx context.Context, r device.Request, _ string) (device.Session, error) {
	return f.Poll(ctx, r, "")
}
func (f *fixtureOwner) Revoke(context.Context, device.Request, string) error { f.calls++; return f.err }

type fixtureLimit struct {
	allowed bool
	err     error
}

func (l fixtureLimit) Allow(context.Context, string, string) (bool, error) { return l.allowed, l.err }

func fixture(t *testing.T, f *fixtureOwner, l Limiter, actor *auth.Identity) http.Handler {
	t.Helper()
	h, err := NewHandler(&Deps{Grants: f, Sessions: f, Limiter: l, Resource: "https://vaultix.test", BrowserAuth: func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if actor == nil {
				w.WriteHeader(401)
				return
			}
			next.ServeHTTP(w, r.WithContext(auth.WithIdentity(r.Context(), actor)))
		})
	}})
	require.NoError(t, err)
	r := chi.NewRouter()
	h.Register(r)
	return r
}
func post(h http.Handler, path, body, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, Path+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func parameters() string {
	return url.Values{"client_id": {device.ClientID}, "resource": {"https://vaultix.test"}, "scope": {device.Scope}}.Encode()
}

func TestHandler_RejectsAmbiguousInputsBeforeOwner(t *testing.T) {
	for name, body := range map[string]string{
		"duplicate": parameters() + "&client_id=another",
		"unknown":   parameters() + "&userId=attacker",
		"oversized": parameters() + "&extra=" + strings.Repeat("x", 8192),
		"malformed": parameters() + "&bad=%xx",
		"empty":     parameters() + "&extra=",
	} {
		t.Run(name, func(t *testing.T) {
			f := &fixtureOwner{}
			h := fixture(t, f, fixtureLimit{allowed: true}, nil)
			w := post(h, "/authorize", body, "")
			require.Equal(t, 400, w.Code)
			require.Equal(t, 0, f.calls)
			require.JSONEq(t, `{"error":"invalid_request"}`, w.Body.String())
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		})
	}
	f := &fixtureOwner{}
	h := fixture(t, f, fixtureLimit{allowed: true}, nil)
	require.Equal(t, 400, post(h, "/authorize?client_id=other", parameters(), "").Code)
	require.Equal(t, 0, f.calls)
}

func TestHandler_ProtocolAndRedactedErrors(t *testing.T) {
	f := &fixtureOwner{}
	h := fixture(t, f, fixtureLimit{allowed: true}, nil)
	w := post(h, "/authorize", parameters(), "")
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), `"verification_uri":"https://vaultix.test/login/device"`)
	for _, test := range []struct {
		err    error
		code   string
		status int
	}{
		{device.ErrPending, "authorization_pending", 400}, {device.ErrSlowDown, "slow_down", 400},
		{device.ErrDenied, "access_denied", 400}, {device.ErrExpired, "expired_token", 400},
		{device.ErrInvalidCredential, "invalid_grant", 400}, {errors.New("password=private-database-value"), "server_error", 503},
	} {
		f.err = test.err
		w = post(h, "/token", parameters()+"&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=private-device-code", "")
		require.Equal(t, test.status, w.Code)
		require.JSONEq(t, `{"error":"`+test.code+`"}`, w.Body.String())
		require.NotContains(t, w.Body.String(), "private")
	}
}

func TestHandler_BrowserApprovalRequiresUserAndOrigin(t *testing.T) {
	for _, actor := range []*auth.Identity{nil, {Actor: auth.ActorTypeIdentity, AuthMode: auth.AuthModeIdentityAccessToken}, {Actor: auth.ActorTypeUser, AuthMode: auth.AuthModeDeviceAccess}, {Actor: auth.ActorTypeUser, AuthMode: auth.AuthModeJWT}} {
		for _, origin := range []string{"", "https://other.test", "https://vaultix.test"} {
			f := &fixtureOwner{}
			h := fixture(t, f, fixtureLimit{allowed: true}, actor)
			w := post(h, "/decision", "user_code=ABCDE-FGHJK&decision=approve", origin)
			if actor != nil && actor.AuthMode == auth.AuthModeJWT && origin == "https://vaultix.test" {
				require.Equal(t, 200, w.Code)
				require.Equal(t, 1, f.calls)
			} else {
				require.Contains(t, []int{401, 403}, w.Code)
				require.Zero(t, f.calls)
			}
		}
	}
}

func TestHandler_SharedLimiterFailsClosed(t *testing.T) {
	for _, test := range []struct {
		limiter fixtureLimit
		status  int
	}{{fixtureLimit{}, 429}, {fixtureLimit{err: errors.New("cache offline")}, 503}} {
		f := &fixtureOwner{}
		h := fixture(t, f, test.limiter, nil)
		w := post(h, "/authorize", parameters(), "")
		require.Equal(t, test.status, w.Code)
		require.Zero(t, f.calls)
	}
}

func TestHandler_DoesNotMixCredentialGrants(t *testing.T) {
	for _, body := range []string{
		parameters() + "&grant_type=refresh_token&refresh_token=private&device_code=private",
		parameters() + "&grant_type=urn:ietf:params:oauth:grant-type:device_code&refresh_token=private",
		parameters() + "&grant_type=password&password=private",
	} {
		f := &fixtureOwner{}
		h := fixture(t, f, fixtureLimit{allowed: true}, nil)
		require.Equal(t, 400, post(h, "/token", body, "").Code)
		require.Zero(t, f.calls)
	}
}
