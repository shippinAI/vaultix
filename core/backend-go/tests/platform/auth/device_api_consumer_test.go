//go:build integration

package auth_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix-cloud/api/internal/server/api/shared"
	"github.com/vaultix-cloud/api/internal/services/auth"
	"github.com/vaultix-cloud/api/internal/services/auth/apiauth"
	"github.com/vaultix-cloud/api/internal/services/auth/device"
	"github.com/vaultix-cloud/api/tests/infra"
)

func deviceConsumer(t *testing.T) (*sessionFixture, *apiauth.ApiAuthenticator, *pgxpool.Pool) {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(stack.Config().DBConnectionURI)
	require.NoError(t, err)
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	db := &bindingDB{pool: pool}
	f := newSessionFixture(t, db)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	authority, err := device.NewNativeAuthority(t.Context(), logger, &device.NativeAuthorityDeps{})
	require.NoError(t, err)
	verifier, err := device.NewAccessVerifier(t.Context(), logger, &device.AccessVerifierDeps{DB: db, Credentials: f.credentials, Authority: authority})
	require.NoError(t, err)
	a, err := apiauth.NewApiAuthenticator(t.Context(), logger, &apiauth.AuthenticatorDeps{DB: db, AuthSecret: infra.AuthSecret, KeyStore: memKeyStore, IdentityPolicy: stack.Config().IdentityTokenPolicy, DeviceAccess: verifier, AssumePrivilege: nil, ErrorHandler: shared.NewErrorHandler(logger)})
	require.NoError(t, err)
	return f, a, pool
}

func deviceConsumerRequest(a *apiauth.ApiAuthenticator, token string, modes ...apiauth.AuthMode) *httptest.ResponseRecorder {
	h := a.RequireAuth(apiauth.WithAuthModes(modes...))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor, err := auth.IdentityFromContext(r.Context())
		if err != nil {
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"actor": actor.ActorID.String(), "org": actor.OrgID.String(), "mode": string(actor.AuthMode)})
	}))
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/protected", http.NoBody)
	r.RemoteAddr = "192.0.2.25:8000"
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestDeviceConsumer_RealActorAndExclusiveAdmission(t *testing.T) {
	for _, method := range []string{"email", "oidc", "okta-saml"} {
		t.Run(method, func(t *testing.T) {
			ctx, approver := newReauthenticationAccount(t)
			approver.AuthMethod = auth.ActorAuthMethod(method)
			f, a, pool := deviceConsumer(t)
			_, session := issueSession(t, f, ctx, approver)
			devicePolicyExec(t, `UPDATE users SET username='current-user',email='current@vaultix.invalid' WHERE id=@user`, pgx.NamedArgs{"user": approver.ActorID})
			actor, mode, err := a.ValidateJWTToken(ctx, session.AccessToken, "")
			require.NoError(t, err)
			require.Equal(t, auth.AuthModeDeviceAccess, mode)
			require.Equal(t, mode, actor.AuthMode)
			require.Equal(t, approver.ActorID, actor.ActorID)
			require.Equal(t, approver.OrgID, actor.OrgID)
			require.Equal(t, approver.RootOrgID, actor.RootOrgID)
			require.Equal(t, actor.OrgID, actor.ParentOrgID)
			require.Equal(t, approver.AuthMethod, actor.AuthMethod)
			require.NotEqual(t, approver.TokenVersionID, actor.TokenVersionID)
			require.EqualValues(t, 1, *actor.SessionAccessVersion)
			require.Equal(t, "current-user", actor.Username)
			require.Equal(t, "current@vaultix.invalid", actor.UserAuthInfo.Email)
			require.Equal(t, 200, deviceConsumerRequest(a, session.AccessToken, apiauth.DeviceAccessAuth).Code)
			for _, route := range []apiauth.AuthMode{apiauth.JWTAuth, apiauth.IdentityAccessTokenAuth, apiauth.ServiceTokenAuth} {
				require.Equal(t, 401, deviceConsumerRequest(a, session.AccessToken, route).Code)
			}
			_, err = a.ValidateJWT(ctx, session.AccessToken)
			require.Error(t, err)
			grant := startDevice(t, f.grant)
			require.ErrorIs(t, f.grant.service.Approve(auth.WithIdentity(ctx, actor), grant.UserCode, actor), device.ErrDenied)
			require.EqualValues(t, 1, pool.Stat().TotalConns())
			require.NotContains(t, f.grant.logs.String(), session.AccessToken)
			require.NotContains(t, f.grant.logs.String(), session.RefreshToken)
		})
	}
}

func TestDeviceConsumer_LiveRestrictionsDenyWithoutCache(t *testing.T) {
	changes := map[string]string{
		"locked":          `UPDATE users SET "isLocked"=true WHERE id=@user`,
		"temporary-lock":  `UPDATE users SET "temporaryLockDateEnd"=clock_timestamp()+interval '1 hour' WHERE id=@user`,
		"unaccepted":      `UPDATE users SET "isAccepted"=false WHERE id=@user`,
		"ghost":           `UPDATE users SET "isGhost"=true WHERE id=@user`,
		"session-version": `UPDATE auth_token_sessions SET "accessVersion"="accessVersion"+1 WHERE id=@session`,
		"deleted-session": `DELETE FROM auth_token_sessions WHERE id=@session`,
		"inactive":        `UPDATE memberships SET "isActive"=false WHERE "actorUserId"=@user`,
		"pending":         `UPDATE memberships SET status='invited' WHERE "actorUserId"=@user`,
		"no-membership":   `DELETE FROM memberships WHERE "actorUserId"=@user`,
		"mfa":             `UPDATE organizations SET "enforceMfa"=true WHERE id=@org`,
		"sso":             `UPDATE organizations SET "authEnforced"=true WHERE id=@org`,
		"expired":         `UPDATE vaultix_device_sessions SET "createdAt"=clock_timestamp()-interval '2 days',"expiresAt"=clock_timestamp()-interval '1 second' WHERE "sessionId"=@session`,
		"deleted-account": `DELETE FROM users WHERE id=@user`,
	}
	for name, query := range changes {
		t.Run(name, func(t *testing.T) {
			ctx, approver := newReauthenticationAccount(t)
			f, a, _ := deviceConsumer(t)
			_, session := issueSession(t, f, ctx, approver)
			actor, err := f.sessions.AuthenticateAccess(ctx, session.AccessToken)
			require.NoError(t, err)
			require.Equal(t, 200, deviceConsumerRequest(a, session.AccessToken, apiauth.DeviceAccessAuth).Code)
			devicePolicyExec(t, query, pgx.NamedArgs{"user": approver.ActorID, "session": actor.TokenVersionID, "org": approver.OrgID})
			response := deviceConsumerRequest(a, session.AccessToken, apiauth.DeviceAccessAuth)
			require.Equal(t, 401, response.Code)
			var body map[string]any
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.IsType(t, "", body["error"])
			require.NotContains(t, response.Body.String(), session.AccessToken)
			require.NotContains(t, response.Body.String(), session.RefreshToken)
		})
	}
}

func TestDeviceConsumer_TenantAndCredentialFamilies(t *testing.T) {
	ctx, approver := newReauthenticationAccount(t)
	f, a, _ := deviceConsumer(t)
	_, session := issueSession(t, f, ctx, approver)
	claims, err := f.credentials.VerifyAccess(session.AccessToken, time.Now())
	require.NoError(t, err)
	claims.OrgID = uuid.New()
	wrongTenant, err := f.credentials.IssueAccess(&claims, time.Now(), time.Now().Add(time.Minute))
	require.NoError(t, err)
	for _, token := range []string{wrongTenant, session.RefreshToken, session.AccessToken[:len(session.AccessToken)-8] + "tampered"} {
		require.Equal(t, 401, deviceConsumerRequest(a, token, apiauth.DeviceAccessAuth, apiauth.JWTAuth).Code)
	}
	_, mode, err := a.ValidateJWTToken(ctx, stack.NodeJS().UserToken(), "")
	require.NoError(t, err)
	require.Equal(t, auth.AuthModeJWT, mode)
	require.Equal(t, 401, deviceConsumerRequest(a, stack.NodeJS().UserToken(), apiauth.DeviceAccessAuth).Code)
	require.Equal(t, 200, deviceConsumerRequest(a, stack.NodeJS().UserToken(), apiauth.JWTAuth, apiauth.DeviceAccessAuth).Code)
}

func TestDeviceConsumer_CancellationAndOneConnectionRecovery(t *testing.T) {
	ctx, approver := newReauthenticationAccount(t)
	f, a, pool := deviceConsumer(t)
	_, session := issueSession(t, f, ctx, approver)
	held, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer held.Release()
	canceled, cancel := context.WithCancel(ctx)
	defer cancel()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() { close(started); _, err := a.ValidateDeviceAccess(canceled, session.AccessToken); done <- err }()
	<-started
	select {
	case err := <-done:
		t.Fatalf("authentication returned before cancellation: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	cancel()
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("authentication did not honor cancellation")
	}
	held.Release()
	actor, err := a.ValidateDeviceAccess(ctx, session.AccessToken)
	require.NoError(t, err)
	require.Equal(t, approver.ActorID, actor.ActorID)
	var group sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		group.Go(func() { _, err := a.ValidateDeviceAccess(context.Background(), session.AccessToken); results <- err })
	}
	group.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	require.EqualValues(t, 1, pool.Stat().TotalConns())
	require.Zero(t, pool.Stat().AcquiredConns())
}
