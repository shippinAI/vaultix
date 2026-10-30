//go:build integration

package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/internal/services/auth/nomen"
	"github.com/vaultix/api/tests/infra"
)

// Only reauthentication issuance is a fixture. Account/session validation uses
// the real native authenticator; provider verification uses a real TLS server.
// Public reauthentication/linking routes and notifications remain an activation gate.
type linkingFreshFixture struct{ denied atomic.Bool }

func (f *linkingFreshFixture) VerifyIdentityLink(_ context.Context, _ *auth.Identity, proof string) (*nomen.LinkAuthorization, error) {
	if proof != "fixture-stepup" || f.denied.Load() {
		return nil, errors.New("fixture reauthentication denied")
	}
	return &nomen.LinkAuthorization{AccessVersion: 1, AuthenticatedAt: time.Now()}, nil
}

type bindingDB struct{ pool *pgxpool.Pool }

func (d *bindingDB) Primary() *pgxpool.Pool { return d.pool }
func (d *bindingDB) Replica() *pgxpool.Pool { panic("binding authority must use the primary") }
func (*bindingDB) ReplicaCount() int        { return 0 }
func (d *bindingDB) Close()                 { d.pool.Close() }

type linkingFixture struct {
	service        *nomen.BindingService
	fresh          *linkingFreshFixture
	subject        string
	issuer         string
	unavailable    atomic.Bool
	posts          atomic.Int32
	beforeResponse func()
	logs           bytes.Buffer
}

func newLinkingFixture(t *testing.T, db pg.DB) *linkingFixture {
	t.Helper()
	f := &linkingFixture{subject: uuid.NewString(), fresh: &linkingFreshFixture{}}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": f.issuer, "introspection_endpoint": f.issuer + "/introspect", "introspection_endpoint_auth_methods_supported": []string{"client_secret_basic"}})
			return
		}
		f.posts.Add(1)
		if f.unavailable.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.ParseForm() != nil || r.Form.Get("token") != "fixture-access-canary" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.beforeResponse != nil {
			f.beforeResponse()
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"active": true, "iss": f.issuer, "sub": f.subject, "aud": "vaultix-resource", "client_id": "public-cli", "token_type": "Bearer", "scope": "openid", "iat": time.Now().Add(-time.Minute).Unix(), "exp": time.Now().Add(time.Minute).Unix()})
	}))
	t.Cleanup(server.Close)
	f.issuer = server.URL
	logger := slog.New(slog.NewTextHandler(&f.logs, nil))
	verifier, err := nomen.NewVerifier(context.Background(), logger, &nomen.VerifierDeps{Config: nomen.Config{Issuer: f.issuer, Endpoint: f.issuer + "/introspect", Audience: "vaultix-resource", AllowedClientIDs: []string{"public-cli"}, RequiredScopes: []string{"openid"}}, Credentials: nomen.ClientCredentials{Method: nomen.ClientSecretBasic, ClientID: "api", Secret: "fixture-resource-canary"}, HTTPClient: server.Client()})
	require.NoError(t, err)
	f.service, err = nomen.NewBindingService(context.Background(), logger, &nomen.BindingDeps{DB: db, Issuer: f.issuer, FreshAuthentication: f.fresh, Introspection: verifier})
	require.NoError(t, err)
	return f
}

func newLinkingAccount(t *testing.T) (context.Context, *auth.Identity) {
	t.Helper()
	ctx := context.Background()
	userID, sessionID := uuid.New(), uuid.New()
	_, err := stack.DB().Primary().Exec(ctx, `INSERT INTO users(id,username,email,"isAccepted","createdAt","updatedAt") VALUES($1,$2,$2,true,NOW(),NOW())`, userID, userID.String()+"@example.test")
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(context.Background(), `DELETE FROM users WHERE id=$1`, userID)
		require.NoError(t, err)
	})
	_, err = stack.DB().Primary().Exec(ctx, `INSERT INTO auth_token_sessions(id,"userId","accessVersion","refreshVersion",ip,"userAgent","lastUsed","createdAt","updatedAt") VALUES($1,$2,1,1,'127.0.0.1','binding-fixture',NOW(),NOW(),NOW())`, sessionID, userID)
	require.NoError(t, err)
	token := signUserJWT(t, infra.AuthSecret, func(c *apiauth.UserJWTClaims) {
		c.UserID = userID
		c.TokenVersionID = sessionID
		c.OrganizationID = uuid.Nil
	})
	identity, err := authenticator.ValidateJWT(ctx, token)
	require.NoError(t, err)
	return auth.WithIdentity(ctx, identity), identity
}

func TestNomenBinding_LifecycleAndDeletionTombstone(t *testing.T) {
	ctx, user := newLinkingAccount(t)
	otherCtx, other := newLinkingAccount(t)
	f := newLinkingFixture(t, stack.DB())
	challenge, err := f.service.BeginLink(ctx, "fixture-stepup")
	require.NoError(t, err)
	_, err = f.service.CompleteLink(otherCtx, challenge.Code, "fixture-access-canary")
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	require.EqualValues(t, 0, f.posts.Load())
	id, err := f.service.CompleteLink(ctx, challenge.Code, "fixture-access-canary")
	require.NoError(t, err)
	resolved, err := f.service.Resolve(ctx, f.subject)
	require.NoError(t, err)
	require.Equal(t, user.ActorID, resolved)
	_, err = f.service.CompleteLink(ctx, challenge.Code, "fixture-access-canary")
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	require.ErrorIs(t, f.service.Revoke(otherCtx, id, "fixture-stepup"), nomen.ErrLinkDenied)
	require.NoError(t, f.service.Revoke(ctx, id, "fixture-stepup"))
	require.NoError(t, f.service.Revoke(ctx, id, "fixture-stepup"))
	_, err = f.service.Resolve(ctx, f.subject)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	next, err := f.service.BeginLink(ctx, "fixture-stepup")
	require.NoError(t, err)
	sameID, err := f.service.CompleteLink(ctx, next.Code, "fixture-access-canary")
	require.NoError(t, err)
	require.Equal(t, id, sameID)
	_, err = stack.DB().Primary().Exec(ctx, `DELETE FROM users WHERE id=$1`, user.ActorID)
	require.NoError(t, err)
	_, err = f.service.Resolve(ctx, f.subject)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	next, err = f.service.BeginLink(otherCtx, "fixture-stepup")
	require.NoError(t, err)
	_, err = f.service.CompleteLink(otherCtx, next.Code, "fixture-access-canary")
	require.ErrorIs(t, err, nomen.ErrBindingConflict)
	var owner *uuid.UUID
	var revoked bool
	err = stack.DB().Primary().QueryRow(ctx, `SELECT "userId","revokedAt" IS NOT NULL FROM vaultix_identity_bindings WHERE id=$1`, id).Scan(&owner, &revoked)
	require.NoError(t, err)
	require.Nil(t, owner)
	require.True(t, revoked)
	var actions []string
	err = stack.DB().Primary().QueryRow(ctx, `SELECT array_agg(action ORDER BY id) FROM vaultix_identity_binding_events WHERE "bindingId"=$1`, id).Scan(&actions)
	require.NoError(t, err)
	require.Equal(t, []string{"linked", "revoked", "relinked", "user-deleted"}, actions)
	for _, query := range []string{`UPDATE vaultix_identity_bindings SET "userId"=$2 WHERE id=$1`, `UPDATE vaultix_identity_binding_events SET "userId"=$2 WHERE "bindingId"=$1`} {
		_, err = stack.DB().Primary().Exec(ctx, query, id, other.ActorID)
		require.Error(t, err)
	}
	_, err = stack.DB().Primary().Exec(ctx, `DELETE FROM vaultix_identity_bindings WHERE id=$1`, id)
	require.Error(t, err)
	require.NotContains(t, f.logs.String(), "canary")
	require.NotContains(t, f.logs.String(), f.subject)
}

func TestNomenBinding_ConcurrentClaimAndReplay(t *testing.T) {
	ctx, _ := newLinkingAccount(t)
	otherCtx, _ := newLinkingAccount(t)
	f := newLinkingFixture(t, stack.DB())
	first, err := f.service.BeginLink(ctx, "fixture-stepup")
	require.NoError(t, err)
	second, err := f.service.BeginLink(otherCtx, "fixture-stepup")
	require.NoError(t, err)
	var success, denied atomic.Int32
	var group sync.WaitGroup
	for i := range 12 {
		group.Go(func() {
			c, code := ctx, first.Code
			if i%2 == 1 {
				c, code = otherCtx, second.Code
			}
			_, err := f.service.CompleteLink(c, code, "fixture-access-canary")
			if err == nil {
				success.Add(1)
			} else if errors.Is(err, nomen.ErrLinkDenied) || errors.Is(err, nomen.ErrBindingConflict) {
				denied.Add(1)
			} else {
				t.Error("unexpected concurrent binding failure")
			}
		})
	}
	group.Wait()
	require.EqualValues(t, 1, success.Load())
	require.EqualValues(t, 11, denied.Load())
	var count int
	err = stack.DB().Primary().QueryRow(ctx, `SELECT count(*) FROM vaultix_identity_bindings WHERE issuer=$1 AND subject=$2`, f.issuer, f.subject).Scan(&count)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestNomenBinding_IntentAndAccountDenials(t *testing.T) {
	for _, scenario := range []string{"reauth", "superseded", "expired", "session-version", "session-delete", "locked", "temporary-lock", "unaccepted", "ghost"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, user := newLinkingAccount(t)
			f := newLinkingFixture(t, stack.DB())
			if scenario == "reauth" {
				f.fresh.denied.Store(true)
				_, err := f.service.BeginLink(ctx, "fixture-stepup")
				require.ErrorIs(t, err, nomen.ErrLinkDenied)
				return
			}
			intent, err := f.service.BeginLink(ctx, "fixture-stepup")
			require.NoError(t, err)
			switch scenario {
			case "superseded":
				_, err = f.service.BeginLink(ctx, "fixture-stepup")
			case "expired":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE vaultix_identity_link_challenges SET "createdAt"=NOW()-interval '6 minutes',"expiresAt"=NOW()-interval '1 minute' WHERE "userId"=$1`, user.ActorID)
			case "session-version":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE auth_token_sessions SET "accessVersion"=2 WHERE id=$1`, user.TokenVersionID)
			case "session-delete":
				_, err = stack.DB().Primary().Exec(ctx, `DELETE FROM auth_token_sessions WHERE id=$1`, user.TokenVersionID)
			case "locked":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isLocked"=true WHERE id=$1`, user.ActorID)
			case "temporary-lock":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "temporaryLockDateEnd"=NOW()+interval '1 hour' WHERE id=$1`, user.ActorID)
			case "unaccepted":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isAccepted"=false WHERE id=$1`, user.ActorID)
			case "ghost":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isGhost"=true WHERE id=$1`, user.ActorID)
			}
			require.NoError(t, err)
			_, err = f.service.CompleteLink(ctx, intent.Code, "fixture-access-canary")
			require.ErrorIs(t, err, nomen.ErrLinkDenied)
		})
	}
}

func TestNomenBinding_ProviderAndAuditFailureRecovery(t *testing.T) {
	ctx, user := newLinkingAccount(t)
	f := newLinkingFixture(t, stack.DB())
	intent, err := f.service.BeginLink(ctx, "fixture-stepup")
	require.NoError(t, err)
	f.unavailable.Store(true)
	_, err = f.service.CompleteLink(ctx, intent.Code, "fixture-access-canary")
	require.ErrorIs(t, err, nomen.ErrUnavailable)
	f.unavailable.Store(false)
	_, err = stack.DB().Primary().Exec(ctx, `ALTER TABLE vaultix_identity_binding_events ADD CONSTRAINT fixture_binding_audit_failure CHECK (false) NOT VALID`)
	require.NoError(t, err)
	_, err = f.service.CompleteLink(ctx, intent.Code, "fixture-access-canary")
	require.ErrorIs(t, err, nomen.ErrBindingUnavailable)
	_, dropErr := stack.DB().Primary().Exec(ctx, `ALTER TABLE vaultix_identity_binding_events DROP CONSTRAINT fixture_binding_audit_failure`)
	require.NoError(t, dropErr)
	_, err = f.service.Resolve(ctx, f.subject)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	_, err = f.service.CompleteLink(ctx, intent.Code, "fixture-access-canary")
	require.NoError(t, err)
	_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isLocked"=true WHERE id=$1`, user.ActorID)
	require.NoError(t, err)
	_, err = f.service.Resolve(ctx, f.subject)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isLocked"=false WHERE id=$1`, user.ActorID)
	require.NoError(t, err)
	_, err = f.service.Resolve(ctx, f.subject)
	require.NoError(t, err)
	require.False(t, strings.Contains(f.logs.String(), "canary"))
}

func TestNomenBinding_OneConnectionAndRestrictionDuringProviderIO(t *testing.T) {
	cfg, err := pgxpool.ParseConfig(stack.Config().DBConnectionURI)
	require.NoError(t, err)
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	db := &bindingDB{pool: pool}
	ctx, user := newLinkingAccount(t)
	f := newLinkingFixture(t, db)
	intent, err := f.service.BeginLink(ctx, "fixture-stepup")
	require.NoError(t, err)
	f.beforeResponse = func() {
		requestCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_, err := pool.Exec(requestCtx, `UPDATE users SET "isLocked"=true WHERE id=$1`, user.ActorID)
		if err != nil {
			t.Error("provider I/O held a database connection")
		}
	}
	_, err = f.service.CompleteLink(ctx, intent.Code, "fixture-access-canary")
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	f.beforeResponse = nil
	_, err = pool.Exec(ctx, `UPDATE users SET "isLocked"=false WHERE id=$1`, user.ActorID)
	require.NoError(t, err)
	_, err = f.service.CompleteLink(ctx, intent.Code, "fixture-access-canary")
	require.NoError(t, err)
}
