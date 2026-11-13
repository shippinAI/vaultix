package apiauth

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix-cloud/api/internal/server/api/shared"
	"github.com/vaultix-cloud/api/internal/services/auth"
	"github.com/vaultix-cloud/api/internal/services/auth/device"
)

type deviceAccessFunc func(context.Context, string) (*auth.Identity, error)

func (f deviceAccessFunc) AuthenticateAccess(ctx context.Context, token string) (*auth.Identity, error) {
	return f(ctx, token)
}

func deviceRoutingToken(header string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(header)) + ".e30.signature"
}

func TestDeviceAccess_RoutingIsNotAuthority(t *testing.T) {
	for _, test := range []struct {
		header string
		mode   auth.AuthMode
	}{
		{`{"typ":"vaultix-device-at+jwt","alg":"HS256"}`, auth.AuthModeDeviceAccess},
		{`{"typ":"vaultix-device-at+jwt","alg":"none"}`, auth.AuthModeDeviceAccess},
		{`{"typ":"JWT","alg":"HS256"}`, auth.AuthModeJWT},
		{`{"typ":42}`, auth.AuthModeJWT}, {`null`, auth.AuthModeJWT},
		{`{"typ":"vaultix-device-at+jwt","padding":"` + strings.Repeat("x", 1024) + `"}`, auth.AuthModeJWT},
	} {
		require.Equal(t, test.mode, ClassifyToken(deviceRoutingToken(test.header)))
	}
}

func TestDeviceAccess_ExplicitRouteAdmission(t *testing.T) {
	for name, allowed := range map[string]AuthMode{"browser": JWTAuth, "workload": IdentityAccessTokenAuth, "service": ServiceTokenAuth, "device": DeviceAccessAuth} {
		t.Run(name, func(t *testing.T) {
			calls := 0
			actor := &auth.Identity{AuthMode: auth.AuthModeDeviceAccess, Actor: auth.ActorTypeUser, ActorID: uuid.New(), OrgID: uuid.New()}
			a := &ApiAuthenticator{errorHandler: shared.NewErrorHandler(slog.New(slog.NewTextHandler(io.Discard, nil))), deviceAccess: deviceAccessFunc(func(_ context.Context, token string) (*auth.Identity, error) {
				calls++
				require.Contains(t, token, "signature")
				return actor, nil
			})}
			h := a.RequireAuth(WithAuthModes(allowed))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got, err := auth.IdentityFromContext(r.Context())
				require.NoError(t, err)
				require.Same(t, actor, got)
				require.Equal(t, "192.0.2.1", got.IPAddress)
				require.Equal(t, "Vaultix consumer test", got.UserAgent)
				require.Nil(t, auth.AssumedPrivilegeFromContext(r.Context()))
				w.WriteHeader(http.StatusNoContent)
			}))
			r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/resource", http.NoBody)
			r.RemoteAddr = "192.0.2.1:9000"
			r.Header.Set("Authorization", "Bearer "+deviceRoutingToken(`{"typ":"vaultix-device-at+jwt"}`))
			r.Header.Set("User-Agent", "Vaultix consumer test")
			r.AddCookie(&http.Cookie{Name: assumePrivilegeCookieName, Value: "browser-cookie-canary"})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if allowed == DeviceAccessAuth {
				require.Equal(t, 204, w.Code)
				require.Equal(t, 1, calls)
			} else {
				require.Equal(t, 401, w.Code)
				require.Zero(t, calls)
			}
		})
	}
}

func TestDeviceAccess_DenialNeverFallsBackToBrowser(t *testing.T) {
	for _, scenario := range []string{"disabled", "invalid", "unavailable", "nil-actor", "browser-actor", "machine-actor"} {
		t.Run(scenario, func(t *testing.T) {
			a := &ApiAuthenticator{errorHandler: shared.NewErrorHandler(slog.New(slog.NewTextHandler(io.Discard, nil)))}
			if scenario != "disabled" {
				a.deviceAccess = deviceAccessFunc(func(context.Context, string) (*auth.Identity, error) {
					switch scenario {
					case "invalid":
						return nil, device.ErrInvalidCredential
					case "unavailable":
						return nil, device.ErrUnavailable
					case "nil-actor":
						return nil, nil
					case "browser-actor":
						return &auth.Identity{AuthMode: auth.AuthModeJWT, Actor: auth.ActorTypeUser}, nil
					default:
						return &auth.Identity{AuthMode: auth.AuthModeDeviceAccess, Actor: auth.ActorTypeIdentity}, nil
					}
				})
			}
			token := deviceRoutingToken(`{"typ":"vaultix-device-at+jwt"}`)
			got, mode, err := a.ValidateJWTToken(context.Background(), token, "")
			require.Nil(t, got)
			require.Error(t, err)
			require.Equal(t, auth.AuthModeDeviceAccess, mode)
			require.NotContains(t, err.Error(), token)
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/resource", http.NoBody)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			a.RequireAuth(WithAuthModes(DeviceAccessAuth, JWTAuth))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("failed authentication reached the resource")
			})).ServeHTTP(response, request)
			expectedStatus := http.StatusUnauthorized
			if scenario == "unavailable" {
				expectedStatus = http.StatusServiceUnavailable
			}
			require.Equal(t, expectedStatus, response.Code)
			require.NotContains(t, response.Body.String(), token)
			got, err = a.ValidateJWT(context.Background(), token)
			require.Nil(t, got)
			require.Error(t, err)
		})
	}
}
