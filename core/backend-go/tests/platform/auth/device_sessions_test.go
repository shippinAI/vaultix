//go:build integration

package auth_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/device"
)

type sessionFixture struct {
	grant       *deviceFixture
	sessions    *device.Sessions
	credentials *device.Credentials
}

func newSessionFixture(t *testing.T, db pg.DB) *sessionFixture {
	t.Helper()
	f := nativeDeviceFixture(t, db)
	logger := slog.New(slog.NewTextHandler(&f.logs, nil))
	credentials, err := device.NewCredentials(context.Background(), logger, &device.CredentialsDeps{Secret: bytes.Repeat([]byte{9}, 32), Resource: deviceRequest().Resource, AccessLifetime: 5 * time.Minute})
	require.NoError(t, err)
	authority, err := device.NewNativeAuthority(context.Background(), logger, &device.NativeAuthorityDeps{})
	require.NoError(t, err)
	sessions, err := device.NewSessions(context.Background(), logger, &device.SessionsDeps{DB: db, Credentials: credentials, Authority: authority, RefreshLifetime: 24 * time.Hour})
	require.NoError(t, err)
	f.deps.SessionIssuer = sessions
	f.service, err = device.NewService(context.Background(), logger, f.deps)
	require.NoError(t, err)
	return &sessionFixture{grant: f, sessions: sessions, credentials: credentials}
}

func issueSession(t *testing.T, f *sessionFixture, ctx context.Context, actor *auth.Identity) (device.Grant, device.Session) {
	t.Helper()
	grant := startDevice(t, f.grant)
	require.NoError(t, f.grant.service.Approve(ctx, grant.UserCode, actor))
	devicePollReady(t, grant.ID)
	result, err := f.grant.service.Poll(sessionHTTP(ctx), deviceRequest(), grant.DeviceCode)
	require.NoError(t, err)
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM vaultix_device_session_events WHERE "userId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	})
	return grant, result
}

func sessionHTTP(ctx context.Context) context.Context {
	return auth.WithHTTPInfo(ctx, &auth.HTTPInfo{IPAddress: "127.0.0.1", UserAgent: "Vaultix CLI integration", UserAgentType: "cli"})
}

func sessionCount(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	require.NoError(t, stack.DB().Primary().QueryRow(context.Background(), query, args...).Scan(&count))
	return count
}

func TestDeviceSessions_IssueRotateAndIndependentBrowser(t *testing.T) {
	for _, method := range []string{"email", "oidc", "okta-saml"} {
		t.Run(method, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			actor.AuthMethod = auth.ActorAuthMethod(method)
			f := newSessionFixture(t, stack.DB())
			grant, first := issueSession(t, f, ctx, actor)
			identity, err := f.sessions.ValidateAccess(ctx, first.AccessToken)
			require.NoError(t, err)
			require.NotEqual(t, actor.TokenVersionID, identity.SessionID)
			require.Equal(t, method, identity.AuthMethod)
			require.Equal(t, "consumed", deviceState(t, grant.ID))
			var stored string
			require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT row_to_json(metadata)::text FROM vaultix_device_sessions metadata WHERE "sessionId"=@id`, pgx.NamedArgs{"id": identity.SessionID}).Scan(&stored))
			require.NotContains(t, stored, first.AccessToken)
			require.NotContains(t, stored, first.RefreshToken)
			require.Equal(t, 1, sessionCount(t, `SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"=@id AND action='issued' AND "auditDeliveredAt" IS NULL AND "notificationDeliveredAt" IS NULL`, pgx.NamedArgs{"id": identity.SessionID}))
			devicePolicyExec(t, `DELETE FROM auth_token_sessions WHERE id=@id`, pgx.NamedArgs{"id": actor.TokenVersionID})
			require.Equal(t, 0, sessionCount(t, `SELECT count(*) FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": grant.ID}))
			_, err = f.sessions.ValidateAccess(ctx, first.AccessToken)
			require.NoError(t, err)
			second, err := f.sessions.Renew(ctx, deviceRequest(), first.RefreshToken)
			require.NoError(t, err)
			require.NotEqual(t, first.RefreshToken, second.RefreshToken)
			locator, err := f.credentials.VerifyRefresh(second.RefreshToken)
			require.NoError(t, err)
			require.EqualValues(t, 2, locator.Generation)
			require.Equal(t, 2, sessionCount(t, `SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"=@id`, pgx.NamedArgs{"id": identity.SessionID}))
			require.NoError(t, f.sessions.Revoke(ctx, deviceRequest(), second.RefreshToken))
			require.NoError(t, f.sessions.Revoke(ctx, deviceRequest(), second.RefreshToken))
			_, err = f.sessions.ValidateAccess(ctx, second.AccessToken)
			require.Error(t, err)
			require.Equal(t, 1, sessionCount(t, `SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"=@id AND action='revoked'`, pgx.NamedArgs{"id": identity.SessionID}))
			require.NotContains(t, f.grant.logs.String(), first.RefreshToken)
		})
	}
}

func TestDeviceSessions_ForgeryAndReuse(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	f := newSessionFixture(t, stack.DB())
	_, first := issueSession(t, f, ctx, actor)
	locator, err := f.credentials.VerifyRefresh(first.RefreshToken)
	require.NoError(t, err)
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(first.RefreshToken, "vxd1."))
	require.NoError(t, err)
	raw[32] ^= 1
	forged := "vxd1." + base64.RawURLEncoding.EncodeToString(raw)
	_, err = f.sessions.Renew(ctx, deviceRequest(), forged)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	require.ErrorIs(t, f.sessions.Revoke(ctx, deviceRequest(), forged), device.ErrInvalidCredential)
	future := locator
	future.Generation++
	futureToken, err := f.credentials.IssueRefresh(future)
	require.NoError(t, err)
	_, err = f.sessions.Renew(ctx, deviceRequest(), futureToken)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	require.ErrorIs(t, f.sessions.Revoke(ctx, deviceRequest(), futureToken), device.ErrInvalidCredential)
	otherNonce, err := f.credentials.IssueRefresh(locator)
	require.NoError(t, err)
	_, err = f.sessions.Renew(ctx, deviceRequest(), otherNonce)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	_, err = f.sessions.ValidateAccess(ctx, first.AccessToken)
	require.NoError(t, err)
	second, err := f.sessions.Renew(ctx, deviceRequest(), first.RefreshToken)
	require.NoError(t, err)
	_, err = f.sessions.Renew(ctx, deviceRequest(), first.RefreshToken)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	_, err = f.sessions.ValidateAccess(ctx, second.AccessToken)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	require.Equal(t, 1, sessionCount(t, `SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"=@id AND action='reuse'`, pgx.NamedArgs{"id": locator.SessionID}))
}

func TestDeviceSessions_CurrentPolicyAndCanonicalRevocation(t *testing.T) {
	for _, scenario := range []string{"locked", "ghost", "session-version", "refresh-version", "deleted-session", "inactive", "no-membership", "mfa", "sso", "lifetime", "expired"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			f := newSessionFixture(t, stack.DB())
			_, session := issueSession(t, f, ctx, actor)
			id, err := f.credentials.VerifyRefresh(session.RefreshToken)
			require.NoError(t, err)
			queries := map[string]string{
				"locked":          `UPDATE users SET "isLocked"=true WHERE id=@user`,
				"ghost":           `UPDATE users SET "isGhost"=true WHERE id=@user`,
				"session-version": `UPDATE auth_token_sessions SET "accessVersion"="accessVersion"+1 WHERE id=@id`,
				"refresh-version": `UPDATE auth_token_sessions SET "refreshVersion"="refreshVersion"+1,"accessVersion"="accessVersion"+1 WHERE id=@id`,
				"deleted-session": `DELETE FROM auth_token_sessions WHERE id=@id`,
				"inactive":        `UPDATE memberships SET "isActive"=false WHERE "actorUserId"=@user`,
				"no-membership":   `DELETE FROM memberships WHERE "actorUserId"=@user`,
				"mfa":             `UPDATE organizations SET "enforceMfa"=true WHERE id=@org`,
				"sso":             `UPDATE organizations SET "authEnforced"=true WHERE id=@org`,
				"lifetime":        `UPDATE organizations SET "userTokenExpiration"='1m' WHERE id=@org`,
				"expired":         `UPDATE vaultix_device_sessions SET "createdAt"=clock_timestamp()-interval '2 days',"expiresAt"=clock_timestamp()-interval '1 second' WHERE "sessionId"=@id`,
			}
			devicePolicyExec(t, queries[scenario], pgx.NamedArgs{"user": actor.ActorID, "id": id.SessionID, "org": actor.OrgID})
			_, err = f.sessions.ValidateAccess(ctx, session.AccessToken)
			require.Error(t, err)
			_, err = f.sessions.Renew(ctx, deviceRequest(), session.RefreshToken)
			require.Error(t, err)
		})
	}
}

func TestDeviceSessions_ConcurrentRefreshAndRedemption(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	f := newSessionFixture(t, stack.DB())
	replica := newSessionFixture(t, stack.DB())
	grant := startDevice(t, f.grant)
	require.NoError(t, f.grant.service.Approve(ctx, grant.UserCode, actor))
	devicePollReady(t, grant.ID)
	var wins atomic.Int32
	var group sync.WaitGroup
	results := make(chan device.Session, 8)
	start := make(chan struct{})
	for i := range 8 {
		group.Go(func() {
			<-start
			svc := f.grant.service
			if i%2 == 0 {
				svc = replica.grant.service
			}
			session, err := svc.Poll(sessionHTTP(ctx), deviceRequest(), grant.DeviceCode)
			if err == nil {
				wins.Add(1)
				results <- session
			}
		})
	}
	close(start)
	group.Wait()
	close(results)
	require.EqualValues(t, 1, wins.Load())
	first := <-results
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM vaultix_device_session_events WHERE "userId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	})
	wins.Store(0)
	start = make(chan struct{})
	results = make(chan device.Session, 8)
	for i := range 8 {
		group.Go(func() {
			<-start
			svc := f.sessions
			if i%2 == 0 {
				svc = replica.sessions
			}
			session, err := svc.Renew(ctx, deviceRequest(), first.RefreshToken)
			if err == nil {
				wins.Add(1)
				results <- session
			}
		})
	}
	close(start)
	group.Wait()
	close(results)
	require.EqualValues(t, 1, wins.Load())
	rotated := <-results
	_, err := f.sessions.ValidateAccess(ctx, rotated.AccessToken)
	require.Error(t, err)
	require.Equal(t, 1, sessionCount(t, `SELECT count(*) FROM vaultix_device_session_events WHERE "userId"=@user AND action='reuse'`, pgx.NamedArgs{"user": actor.ActorID}))
}

func TestDeviceSessions_EventFailureRollsBackAndOneConnection(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	cfg, err := pgxpool.ParseConfig(stack.Config().DBConnectionURI)
	require.NoError(t, err)
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	f := newSessionFixture(t, &bindingDB{pool: pool})
	grant := startDevice(t, f.grant)
	require.NoError(t, f.grant.service.Approve(ctx, grant.UserCode, actor))
	devicePollReady(t, grant.ID)
	constraint := "session_event_fixture_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	block := func() {
		devicePolicyExec(t, `ALTER TABLE vaultix_device_session_events ADD CONSTRAINT `+constraint+` CHECK ("userId"<>'`+actor.ActorID.String()+`'::uuid) NOT VALID`)
	}
	unblock := func() {
		devicePolicyExec(t, `ALTER TABLE vaultix_device_session_events DROP CONSTRAINT IF EXISTS `+constraint)
	}
	t.Cleanup(unblock)
	block()
	_, err = f.grant.service.Poll(sessionHTTP(ctx), deviceRequest(), grant.DeviceCode)
	require.ErrorIs(t, err, device.ErrUnavailable)
	require.Equal(t, "approved", deviceState(t, grant.ID))
	require.Equal(t, 0, sessionCount(t, `SELECT count(*) FROM auth_token_sessions WHERE "userId"=@user AND "sessionType"='device-v1'`, pgx.NamedArgs{"user": actor.ActorID}))
	unblock()
	first, err := f.grant.service.Poll(sessionHTTP(ctx), deviceRequest(), grant.DeviceCode)
	require.NoError(t, err)
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM vaultix_device_session_events WHERE "userId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	})
	block()
	_, err = f.sessions.Renew(ctx, deviceRequest(), first.RefreshToken)
	require.ErrorIs(t, err, device.ErrUnavailable)
	unblock()
	second, err := f.sessions.Renew(ctx, deviceRequest(), first.RefreshToken)
	require.NoError(t, err)
	block()
	require.ErrorIs(t, f.sessions.Revoke(ctx, deviceRequest(), second.RefreshToken), device.ErrUnavailable)
	_, err = f.sessions.ValidateAccess(ctx, second.AccessToken)
	require.NoError(t, err)
	unblock()
	require.NoError(t, f.sessions.Revoke(ctx, deviceRequest(), second.RefreshToken))
}

func TestDeviceSessions_LifetimeAndTenantClaimBinding(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	devicePolicyExec(t, `UPDATE organizations SET "userTokenExpiration"='1m' WHERE id=@org`, pgx.NamedArgs{"org": actor.OrgID})
	f := newSessionFixture(t, stack.DB())
	_, session := issueSession(t, f, ctx, actor)
	require.Equal(t, time.Minute, session.ExpiresIn)
	identity, err := f.credentials.VerifyAccess(session.AccessToken, time.Now())
	require.NoError(t, err)
	var seconds float64
	require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT extract(epoch FROM "expiresAt"-"createdAt") FROM vaultix_device_sessions WHERE "sessionId"=@id`, pgx.NamedArgs{"id": identity.SessionID}).Scan(&seconds))
	require.Equal(t, float64(60), seconds)
	identity.OrgID = uuid.New()
	wrong, err := f.credentials.IssueAccess(&identity, time.Now(), time.Now().Add(30*time.Second))
	require.NoError(t, err)
	_, err = f.sessions.ValidateAccess(ctx, wrong)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	request := deviceRequest()
	request.Resource = "https://other.example.test"
	_, err = f.sessions.Renew(ctx, request, session.RefreshToken)
	require.ErrorIs(t, err, device.ErrInvalidRequest)
	_, err = f.sessions.ValidateAccess(ctx, session.AccessToken)
	require.NoError(t, err)
}

func TestDeviceSessions_FactorReplacementAndBypassProvenance(t *testing.T) {
	for _, method := range []string{"email", "totp", "webauthn"} {
		t.Run(method, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			deviceRole(t, actor, "admin")
			devicePolicyExec(t, `UPDATE organizations SET "authEnforced"=true,"bypassOrgAuthEnabled"=true,"enforceMfa"=true,"selectedMfaMethod"=@method WHERE id=@org`, pgx.NamedArgs{"org": actor.OrgID, "method": method})
			factor := uuid.New()
			switch method {
			case "totp":
				devicePolicyExec(t, `INSERT INTO totp_configs(id,"userId","isVerified","encryptedSecret") VALUES(@id,@user,true,@secret)`, pgx.NamedArgs{"id": factor, "user": actor.ActorID, "secret": []byte("public-encrypted-fixture")})
			case "webauthn":
				devicePolicyExec(t, `INSERT INTO webauthn_credentials(id,"userId","credentialId","publicKey") VALUES(@id,@user,@credential,'fixture-key')`, pgx.NamedArgs{"id": factor, "user": actor.ActorID, "credential": factor.String()})
			}
			actor.IsMfaVerified, actor.MfaMethod = true, method
			f := newSessionFixture(t, stack.DB())
			_, session := issueSession(t, f, ctx, actor)
			identity, err := f.sessions.ValidateAccess(ctx, session.AccessToken)
			require.NoError(t, err)
			require.True(t, identity.SSOBypass)
			require.Equal(t, method, identity.MFAMethod)
			require.Equal(t, 1, sessionCount(t, `SELECT count(*) FROM vaultix_device_session_events WHERE "sessionId"=@id AND provenance->>'ssoBypass'='true' AND "notificationDeliveredAt" IS NULL`, pgx.NamedArgs{"id": identity.SessionID}))
			switch method {
			case "email":
				devicePolicyExec(t, `UPDATE users SET email='changed-device-fixture@vaultix.invalid' WHERE id=@user`, pgx.NamedArgs{"user": actor.ActorID})
			case "totp":
				devicePolicyExec(t, `UPDATE totp_configs SET "encryptedSecret"=@secret WHERE id=@id`, pgx.NamedArgs{"id": factor, "secret": []byte("replacement-public-fixture")})
			case "webauthn":
				devicePolicyExec(t, `DELETE FROM webauthn_credentials WHERE id=@id`, pgx.NamedArgs{"id": factor})
			}
			_, err = f.sessions.ValidateAccess(ctx, session.AccessToken)
			require.Error(t, err)
			_, err = f.sessions.Renew(ctx, deviceRequest(), session.RefreshToken)
			require.Error(t, err)
		})
	}
}

func TestDeviceSessions_SeparateFamiliesAndCanonicalLogout(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	f := newSessionFixture(t, stack.DB())
	_, first := issueSession(t, f, ctx, actor)
	_, second := issueSession(t, f, ctx, actor)
	require.NoError(t, f.sessions.Revoke(ctx, deviceRequest(), first.RefreshToken))
	_, err := f.sessions.ValidateAccess(ctx, second.AccessToken)
	require.NoError(t, err)
	devicePolicyExec(t, `DELETE FROM auth_token_sessions WHERE "userId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	_, err = f.sessions.ValidateAccess(ctx, second.AccessToken)
	require.Error(t, err)
	_, err = f.sessions.Renew(ctx, deviceRequest(), second.RefreshToken)
	require.Error(t, err)
	require.Equal(t, 3, sessionCount(t, `SELECT count(*) FROM vaultix_device_session_events WHERE "userId"=@user`, pgx.NamedArgs{"user": actor.ActorID}))
}
