//go:build integration

package auth_test

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/internal/services/auth/nomen"
	"github.com/vaultix/api/tests/infra"
)

// Generated independently by the canonical Node bcrypt implementation. Public fixture only.
const reauthPassword = "Native-Reauth-fixture-2026!"
const reauthHash = "$2b$04$EnwJ5WPEU83MZVuPzpOW2eR9WP4dCMDEP2y31pJGalkjcyP0Yr6Ku"

func newReauthenticationAccount(t *testing.T) (context.Context, *auth.Identity) {
	t.Helper()
	ctx, actor := newLinkingAccount(t)
	orgID := uuid.New()
	_, err := stack.DB().Primary().Exec(ctx, `INSERT INTO organizations (id,name,slug) VALUES($1,'reauth-fixture',$2)`, orgID, orgID.String())
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID)
		require.NoError(t, err)
	})
	_, err = stack.DB().Primary().Exec(ctx, `INSERT INTO memberships (id,"actorUserId",scope,"scopeOrgId",status,"isActive") VALUES($1,$2,'organization',$3,'accepted',true)`, uuid.New(), actor.ActorID, orgID)
	require.NoError(t, err)
	_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "hashedPassword"=$2,"authMethods"=ARRAY['email'],"isEmailVerified"=true WHERE id=$1`, actor.ActorID, reauthHash)
	require.NoError(t, err)
	token := signUserJWT(t, infra.AuthSecret, func(c *apiauth.UserJWTClaims) {
		c.UserID = actor.ActorID
		c.TokenVersionID = actor.TokenVersionID
		c.OrganizationID = orgID
		c.AuthMethod = "email"
	})
	actor, err = authenticator.ValidateJWT(ctx, token)
	require.NoError(t, err)
	require.NotNil(t, actor.SessionAccessVersion)
	require.EqualValues(t, 1, *actor.SessionAccessVersion)
	return auth.WithIdentity(context.Background(), actor), actor
}

func newReauthentication(t *testing.T, db pg.DB) (*linkingFixture, *nomen.PasswordReauthentication, nomen.IdentityIntent) {
	t.Helper()
	fixture := newLinkingFixture(t, db)
	logger := slog.New(slog.NewTextHandler(&fixture.logs, nil))
	producer, err := nomen.NewPasswordReauthentication(context.Background(), logger, &nomen.PasswordReauthenticationDeps{DB: db, Issuer: fixture.issuer})
	require.NoError(t, err)
	fixture.service, err = nomen.NewBindingService(context.Background(), logger, &nomen.BindingDeps{DB: db, Issuer: fixture.issuer, FreshAuthentication: producer, Introspection: fixture.verifier})
	require.NoError(t, err)
	return fixture, producer, nomen.IdentityIntent{Action: nomen.IdentityLink, Issuer: fixture.issuer}
}

func TestReauthentication_RealPasswordBindingAndTargetedRevocation(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	fixture, producer, intent := newReauthentication(t, stack.DB())
	proof, err := producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
	require.NotContains(t, fmt.Sprintf("%v %#v", proof, proof), proof.Code)
	var proofID uuid.UUID
	err = stack.DB().Primary().QueryRow(ctx, `SELECT id FROM vaultix_identity_reauth_proofs WHERE "userId"=$1`, actor.ActorID).Scan(&proofID)
	require.NoError(t, err)
	challenge, err := fixture.service.BeginLink(ctx, proof.Code)
	require.NoError(t, err)
	_, err = fixture.service.BeginLink(ctx, proof.Code)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	binding, err := fixture.service.CompleteLink(ctx, challenge.Code, "fixture-access-canary")
	require.NoError(t, err)
	var provenance uuid.UUID
	err = stack.DB().Primary().QueryRow(ctx, `SELECT "proofId" FROM vaultix_identity_binding_events WHERE "bindingId"=$1 AND action='linked'`, binding).Scan(&provenance)
	require.NoError(t, err)
	require.Equal(t, proofID, provenance)
	linkOnly, err := producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
	require.ErrorIs(t, fixture.service.Revoke(ctx, binding, linkOnly.Code), nomen.ErrLinkDenied)
	revoke := nomen.IdentityIntent{Action: nomen.IdentityRevoke, Issuer: fixture.issuer, BindingID: binding}
	otherBinding := uuid.New()
	_, err = stack.DB().Primary().Exec(ctx, `INSERT INTO vaultix_identity_bindings(id,issuer,subject,"userId","proofId","sessionId") VALUES($1,$2,$3,$4,$5,$6)`, otherBinding, fixture.issuer, "other-"+fixture.subject, actor.ActorID, uuid.New(), actor.TokenVersionID)
	require.NoError(t, err)
	revocation, err := producer.Authenticate(ctx, revoke, reauthPassword)
	require.NoError(t, err)
	_, err = fixture.service.BeginLink(ctx, revocation.Code)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	require.ErrorIs(t, fixture.service.Revoke(ctx, otherBinding, revocation.Code), nomen.ErrLinkDenied)
	otherOwner, err := fixture.service.Resolve(ctx, "other-"+fixture.subject)
	require.NoError(t, err)
	require.Equal(t, actor.ActorID, otherOwner)
	require.NoError(t, fixture.service.Revoke(ctx, binding, revocation.Code))
	require.ErrorIs(t, fixture.service.Revoke(ctx, binding, revocation.Code), nomen.ErrLinkDenied)
	_, err = fixture.service.Resolve(ctx, fixture.subject)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	require.NotContains(t, fixture.logs.String(), reauthPassword)
	require.NotContains(t, fixture.logs.String(), proof.Code)
}

func TestReauthentication_DenialsAndCurrentPolicy(t *testing.T) {
	for _, scenario := range []string{"password", "missing-version", "version-changed", "deleted-session", "locked", "unaccepted", "ghost", "unverified-email", "user-mfa", "org-mfa", "federation", "no-password", "missing-org", "wrong-issuer", "invalid-action", "invalid-target"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			_, producer, intent := newReauthentication(t, stack.DB())
			password := reauthPassword
			expected := nomen.ErrLinkDenied
			var query string
			id := actor.ActorID
			switch scenario {
			case "password":
				password = "incorrect"
			case "missing-version":
				actor.SessionAccessVersion = nil
			case "version-changed":
				query = `UPDATE auth_token_sessions SET "accessVersion"=2 WHERE id=$1`
				id = actor.TokenVersionID
			case "deleted-session":
				query = `DELETE FROM auth_token_sessions WHERE id=$1`
				id = actor.TokenVersionID
			case "locked":
				query = `UPDATE users SET "isLocked"=true WHERE id=$1`
			case "unaccepted":
				query = `UPDATE users SET "isAccepted"=false WHERE id=$1`
			case "ghost":
				query = `UPDATE users SET "isGhost"=true WHERE id=$1`
			case "unverified-email":
				query = `UPDATE users SET "isEmailVerified"=false WHERE id=$1`
				expected = nomen.ErrReauthenticationMethod
			case "user-mfa":
				query = `UPDATE users SET "isMfaEnabled"=true WHERE id=$1`
				expected = nomen.ErrReauthenticationMethod
			case "org-mfa":
				query = `UPDATE organizations SET "enforceMfa"=true WHERE id=$1`
				id = actor.OrgID
				expected = nomen.ErrReauthenticationMethod
			case "federation":
				query = `UPDATE organizations SET "authEnforced"=true WHERE id=$1`
				id = actor.OrgID
				expected = nomen.ErrReauthenticationMethod
			case "no-password":
				query = `UPDATE users SET "hashedPassword"=NULL WHERE id=$1`
				expected = nomen.ErrReauthenticationMethod
			case "missing-org":
				actor.OrgID = uuid.Nil
			case "wrong-issuer":
				intent.Issuer = "https://other.example.test"
			case "invalid-action":
				intent.Action = "unknown"
			case "invalid-target":
				intent.BindingID = uuid.New()
			}
			if query != "" {
				_, err := stack.DB().Primary().Exec(ctx, query, id)
				require.NoError(t, err)
			}
			_, err := producer.Authenticate(ctx, intent, password)
			require.ErrorIs(t, err, expected)
			var count int
			require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT count(*) FROM vaultix_identity_reauth_proofs WHERE "userId"=$1`, actor.ActorID).Scan(&count))
			require.Zero(t, count)
		})
	}
}

func TestReauthentication_SupersessionExpiryAndChangesAfterProof(t *testing.T) {
	for _, scenario := range []string{"superseded", "expired", "password", "session", "mfa", "org-policy", "other-user", "other-session", "other-org"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			fixture, producer, intent := newReauthentication(t, stack.DB())
			proof, err := producer.Authenticate(ctx, intent, reauthPassword)
			require.NoError(t, err)
			expected := nomen.ErrLinkDenied
			switch scenario {
			case "superseded":
				_, err = producer.Authenticate(ctx, intent, reauthPassword)
			case "expired":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE vaultix_identity_reauth_proofs SET "authenticatedAt"=NOW()-interval '6 minutes',"expiresAt"=NOW()-interval '1 minute' WHERE "userId"=$1`, actor.ActorID)
			case "password":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "hashedPassword"="hashedPassword"||'x' WHERE id=$1`, actor.ActorID)
			case "session":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE auth_token_sessions SET "accessVersion"=2 WHERE id=$1`, actor.TokenVersionID)
			case "mfa":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isMfaEnabled"=true WHERE id=$1`, actor.ActorID)
				expected = nomen.ErrReauthenticationMethod
			case "org-policy":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE organizations SET "enforceMfa"=true WHERE id=$1`, actor.OrgID)
				expected = nomen.ErrReauthenticationMethod
			case "other-user":
				ctx, _ = newReauthenticationAccount(t)
			case "other-session":
				otherSession := uuid.New()
				_, err = stack.DB().Primary().Exec(ctx, `INSERT INTO auth_token_sessions(id,"userId","accessVersion","refreshVersion",ip,"userAgent","lastUsed","createdAt","updatedAt") VALUES($1,$2,1,1,'127.0.0.1','alternative-session',NOW(),NOW(),NOW())`, otherSession, actor.ActorID)
				require.NoError(t, err)
				ctx, _ = reauthenticationContext(t, actor.ActorID, otherSession, actor.OrgID, actor.RootOrgID, 1)
			case "other-org":
				otherOrg := reauthenticationOrganization(t, actor.ActorID, uuid.Nil)
				ctx, _ = reauthenticationContext(t, actor.ActorID, actor.TokenVersionID, otherOrg, otherOrg, 1)
			}
			require.NoError(t, err)
			_, err = fixture.service.BeginLink(ctx, proof.Code)
			require.ErrorIs(t, err, expected)
		})
	}
}

func TestReauthentication_AtomicConsumptionAndRecovery(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	fixture, producer, intent := newReauthentication(t, stack.DB())
	proof, err := producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
	_, err = stack.DB().Primary().Exec(ctx, `ALTER TABLE vaultix_identity_link_challenges ADD CONSTRAINT fixture_reauth_failure CHECK(false) NOT VALID`)
	require.NoError(t, err)
	_, err = fixture.service.BeginLink(ctx, proof.Code)
	require.ErrorIs(t, err, nomen.ErrBindingUnavailable)
	_, err = stack.DB().Primary().Exec(ctx, `ALTER TABLE vaultix_identity_link_challenges DROP CONSTRAINT fixture_reauth_failure`)
	require.NoError(t, err)
	var consumed bool
	require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT "consumedAt" IS NOT NULL FROM vaultix_identity_reauth_proofs WHERE "userId"=$1`, actor.ActorID).Scan(&consumed))
	require.False(t, consumed)
	challenge, err := fixture.service.BeginLink(ctx, proof.Code)
	require.NoError(t, err)
	fixture.beforeResponse = func() {
		_, err := stack.DB().Primary().Exec(ctx, `UPDATE users SET "isMfaEnabled"=true WHERE id=$1`, actor.ActorID)
		if err != nil {
			t.Error("policy change during provider verification failed")
		}
	}
	_, err = fixture.service.CompleteLink(ctx, challenge.Code, "fixture-access-canary")
	require.ErrorIs(t, err, nomen.ErrReauthenticationMethod)
	fixture.beforeResponse = nil
	_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isMfaEnabled"=false WHERE id=$1`, actor.ActorID)
	require.NoError(t, err)
	_, err = fixture.service.CompleteLink(ctx, challenge.Code, "fixture-access-canary")
	require.NoError(t, err)
}

func TestReauthentication_ConcurrentReplayAndDurableAttemptBudget(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	fixture, producer, intent := newReauthentication(t, stack.DB())
	proof, err := producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
	var success, denied atomic.Int32
	var group sync.WaitGroup
	for range 12 {
		group.Go(func() {
			_, err := fixture.service.BeginLink(ctx, proof.Code)
			switch {
			case err == nil:
				success.Add(1)
			case errors.Is(err, nomen.ErrLinkDenied):
				denied.Add(1)
			default:
				t.Error("unexpected proof replay result")
			}
		})
	}
	group.Wait()
	require.EqualValues(t, 1, success.Load())
	require.EqualValues(t, 11, denied.Load())
	// The first successful issuance already consumed one of five durable slots.
	for range 12 {
		group.Go(func() {
			_, err := producer.Authenticate(ctx, intent, "incorrect")
			if !errors.Is(err, nomen.ErrLinkDenied) && !errors.Is(err, nomen.ErrReauthenticationAttempts) && !errors.Is(err, nomen.ErrReauthenticationBusy) {
				t.Error("unexpected attempt admission result")
			}
		})
	}
	group.Wait()
	var attempts int
	require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT attempts FROM vaultix_identity_reauth_attempts WHERE "userId"=$1`, actor.ActorID).Scan(&attempts))
	require.Equal(t, 5, attempts)
	_, err = producer.Authenticate(ctx, intent, reauthPassword)
	require.ErrorIs(t, err, nomen.ErrReauthenticationAttempts)
	_, err = stack.DB().Primary().Exec(ctx, `UPDATE vaultix_identity_reauth_attempts SET "windowStartedAt"=NOW()-interval '6 minutes' WHERE "userId"=$1`, actor.ActorID)
	require.NoError(t, err)
	_, err = producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
}

func TestReauthentication_OneConnection(t *testing.T) {
	ctx, _ := newReauthenticationAccount(t)
	cfg, err := pgxpool.ParseConfig(stack.Config().DBConnectionURI)
	require.NoError(t, err)
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	fixture, producer, intent := newReauthentication(t, &bindingDB{pool: pool})
	proof, err := producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
	challenge, err := fixture.service.BeginLink(ctx, proof.Code)
	require.NoError(t, err)
	_, err = fixture.service.CompleteLink(ctx, challenge.Code, "fixture-access-canary")
	require.NoError(t, err)
}

func reauthenticationOrganization(t *testing.T, user, root uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var parent *uuid.UUID
	if root != uuid.Nil {
		parent = &root
	}
	_, err := stack.DB().Primary().Exec(context.Background(), `INSERT INTO organizations(id,name,slug,"rootOrgId","parentOrgId") VALUES($1,'alternative-reauth-org',$2,$3,$3)`, id, id.String(), parent)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, id)
		require.NoError(t, err)
	})
	_, err = stack.DB().Primary().Exec(context.Background(), `INSERT INTO memberships(id,"actorUserId",scope,"scopeOrgId",status,"isActive") VALUES($1,$2,'organization',$3,'accepted',true)`, uuid.New(), user, id)
	require.NoError(t, err)
	return id
}

func reauthenticationContext(t *testing.T, user, session, org, root uuid.UUID, version int) (context.Context, *auth.Identity) {
	t.Helper()
	token := signUserJWT(t, infra.AuthSecret, func(c *apiauth.UserJWTClaims) {
		c.UserID = user
		c.TokenVersionID = session
		c.OrganizationID = root
		c.AccessVersion = version
		c.AuthMethod = "email"
		if org != root {
			c.SubOrganizationID = org
		}
	})
	actor, err := authenticator.ValidateJWT(context.Background(), token)
	require.NoError(t, err)
	return auth.WithIdentity(context.Background(), actor), actor
}

func TestReauthentication_ValidAlternativeIssuer(t *testing.T) {
	ctx, _ := newReauthenticationAccount(t)
	fixture, producer, intent := newReauthentication(t, stack.DB())
	proof, err := producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
	otherIssuer := "https://other-issuer.example.test"
	logger := slog.New(slog.NewTextHandler(&fixture.logs, nil))
	otherProducer, err := nomen.NewPasswordReauthentication(ctx, logger, &nomen.PasswordReauthenticationDeps{DB: stack.DB(), Issuer: otherIssuer})
	require.NoError(t, err)
	otherBinding, err := nomen.NewBindingService(ctx, logger, &nomen.BindingDeps{DB: stack.DB(), Issuer: otherIssuer, FreshAuthentication: otherProducer, Introspection: fixture.verifier})
	require.NoError(t, err)
	_, err = otherBinding.BeginLink(ctx, proof.Code)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	_, err = fixture.service.BeginLink(ctx, proof.Code)
	require.NoError(t, err)
}

func TestReauthentication_ExplicitVersionZero(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	_, err := stack.DB().Primary().Exec(ctx, `UPDATE auth_token_sessions SET "accessVersion"=0 WHERE id=$1`, actor.TokenVersionID)
	require.NoError(t, err)
	ctx, actor = reauthenticationContext(t, actor.ActorID, actor.TokenVersionID, actor.OrgID, actor.RootOrgID, 0)
	require.NotNil(t, actor.SessionAccessVersion)
	require.Zero(t, *actor.SessionAccessVersion)
	fixture, producer, intent := newReauthentication(t, stack.DB())
	proof, err := producer.Authenticate(ctx, intent, reauthPassword)
	require.NoError(t, err)
	_, err = fixture.service.BeginLink(ctx, proof.Code)
	require.NoError(t, err)
}

func TestReauthentication_SuborganizationAndInstancePolicy(t *testing.T) {
	for _, scenario := range []string{"root-mfa", "selected-mfa", "instance-password-disabled", "fips-instance", "suborg-success"} {
		t.Run(scenario, func(t *testing.T) {
			_, actor := newReauthenticationAccount(t)
			child := reauthenticationOrganization(t, actor.ActorID, actor.OrgID)
			ctx, actor := reauthenticationContext(t, actor.ActorID, actor.TokenVersionID, child, actor.OrgID, 1)
			fixture, producer, intent := newReauthentication(t, stack.DB())
			var err error
			switch scenario {
			case "root-mfa":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE organizations SET "enforceMfa"=true WHERE id=$1`, actor.RootOrgID)
			case "selected-mfa":
				_, err = stack.DB().Primary().Exec(ctx, `UPDATE organizations SET "enforceMfa"=true WHERE id=$1`, actor.OrgID)
			case "instance-password-disabled", "fips-instance":
				var instance uuid.UUID
				var enabled []string
				var fips bool
				require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT id,"enabledLoginMethods","fipsEnabled" FROM super_admin WHERE initialized IS TRUE ORDER BY id LIMIT 1`).Scan(&instance, &enabled, &fips))
				t.Cleanup(func() {
					_, err := stack.DB().Primary().Exec(context.Background(), `UPDATE super_admin SET "enabledLoginMethods"=$2,"fipsEnabled"=$3 WHERE id=$1`, instance, enabled, fips)
					require.NoError(t, err)
				})
				if scenario == "fips-instance" {
					_, err = stack.DB().Primary().Exec(ctx, `UPDATE super_admin SET "fipsEnabled"=true WHERE id=$1`, instance)
				} else {
					_, err = stack.DB().Primary().Exec(ctx, `UPDATE super_admin SET "enabledLoginMethods"=ARRAY[]::text[] WHERE id=$1`, instance)
				}
			case "suborg-success":
			}
			require.NoError(t, err)
			proof, err := producer.Authenticate(ctx, intent, reauthPassword)
			if scenario != "suborg-success" {
				require.ErrorIs(t, err, nomen.ErrReauthenticationMethod)
				return
			}
			require.NoError(t, err)
			_, err = fixture.service.BeginLink(ctx, proof.Code)
			require.NoError(t, err)
		})
	}
}
