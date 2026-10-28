//go:build integration

package auth_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/tests/infra"
)

// Frozen schema copies model stale state, not a physical replication topology.
// Both pools belong to the disposable test database, never the operator instance.
type authorityDB struct {
	primary, replica, unavailable *pgxpool.Pool
	primaryReads, replicaReads    int
	failAt                        int
}

func (db *authorityDB) Primary() *pgxpool.Pool {
	db.primaryReads++
	if db.failAt > 0 && db.primaryReads == db.failAt {
		return db.unavailable
	}
	return db.primary
}

func (db *authorityDB) Replica() *pgxpool.Pool { db.replicaReads++; return db.replica }
func (db *authorityDB) ReplicaCount() int      { return 1 }
func (db *authorityDB) Close()                 {} // The fixture owns these pools.

func copyAuthorityPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	schema := "authority_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	name := pgx.Identifier{schema}.Sanitize()
	_, err := stack.DB().Primary().Exec(ctx, "CREATE SCHEMA "+name)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(ctx, "DROP SCHEMA "+name+" CASCADE")
		require.NoError(t, err)
	})
	for _, table := range []string{
		"auth_token_sessions", "users", "organizations", "projects", "identities",
		"identity_access_tokens", "identity_access_token_revocations", "service_tokens",
		"memberships", "groups", "user_group_membership", "identity_group_membership", "identity_universal_auths",
	} {
		_, err := stack.DB().Primary().Exec(ctx, "CREATE TABLE "+pgx.Identifier{schema, table}.Sanitize()+
			" AS SELECT * FROM "+pgx.Identifier{"public", table}.Sanitize())
		require.NoError(t, err)
	}
	cfg := stack.DB().Primary().Config()
	cfg.ConnConfig.RuntimeParams["search_path"] = name
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, pool.Ping(ctx))
	return pool
}

func newAuthorityValidator(t *testing.T) (*authorityDB, *apiauth.ApiAuthenticator) {
	t.Helper()
	db := &authorityDB{primary: copyAuthorityPool(t), replica: copyAuthorityPool(t)}
	closed, err := pgxpool.NewWithConfig(context.Background(), db.primary.Config())
	require.NoError(t, err)
	closed.Close()
	db.unavailable = closed
	validator, err := apiauth.NewApiAuthenticator(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &apiauth.AuthenticatorDeps{
		DB: db, AuthSecret: infra.AuthSecret, KeyStore: keystore.NewMemoryKeyStore(),
		AssumePrivilege: nil, ErrorHandler: infra.NewNopErrorHandler(), IdentityPolicy: stack.Config().IdentityTokenPolicy,
	})
	require.NoError(t, err)
	return db, validator
}

type authorityTokens struct {
	user, identity, legacy, service                          string
	userID, identityID, tokenID, serviceID, orgID, projectID string
}

func newAuthorityTokens(t *testing.T) authorityTokens {
	t.Helper()
	node := stack.NodeJS()
	project := node.CreateProject(t, "authority-"+uuid.NewString()[:8])
	t.Cleanup(func() { node.DeleteProject(t, project.ID) })
	service := node.CreateServiceToken(t, project.ID, nil)
	t.Cleanup(func() { node.DeleteServiceToken(t, service.ID) })
	identity := node.CreateIdentity(t, "authority-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	token := node.GetIdentityAccessToken(t, identity.ID)
	tokenID := uuid.NewString()
	_, err := stack.DB().Primary().Exec(context.Background(), `INSERT INTO identity_access_tokens
		(id, "identityId", "isAccessTokenRevoked", "accessTokenTTL", "accessTokenMaxTTL",
		"accessTokenNumUses", "accessTokenNumUsesLimit", "accessTokenLastRenewedAt", "authMethod", "createdAt", "updatedAt")
		VALUES ($1, $2, false, 3600, 7200, 0, 0, NOW(), 'universal-auth', NOW(), NOW())`, tokenID, identity.ID)
	require.NoError(t, err)
	legacy := signIdentityJWT(t, infra.AuthSecret, func(c *apiauth.IdentityJWTClaims) {
		c.IdentityID = uuid.MustParse(identity.ID)
		c.IdentityAccessTokenID = tokenID
	})
	return authorityTokens{user: node.UserToken(), identity: token, legacy: legacy, service: service.Token,
		userID: node.UserID(), identityID: identity.ID, tokenID: tokenID, serviceID: service.ID, orgID: node.OrgID(), projectID: project.ID}
}

func (tokens *authorityTokens) validate(ctx context.Context, validator *apiauth.ApiAuthenticator, path string) (*auth.Identity, error) {
	switch path {
	case "user":
		return validator.ValidateJWT(ctx, tokens.user)
	case "user-unified":
		identity, _, err := validator.ValidateJWTToken(ctx, tokens.user, "127.0.0.1")
		return identity, err
	case "identity":
		return validator.ValidateIdentityAccessToken(ctx, tokens.identity, "127.0.0.1")
	case "identity-unified":
		identity, _, err := validator.ValidateJWTToken(ctx, tokens.identity, "127.0.0.1")
		return identity, err
	case "legacy":
		return validator.ValidateIdentityAccessToken(ctx, tokens.legacy, "127.0.0.1")
	case "legacy-unified":
		identity, _, err := validator.ValidateJWTToken(ctx, tokens.legacy, "127.0.0.1")
		return identity, err
	default:
		return validator.ValidateServiceToken(ctx, tokens.service)
	}
}

func TestAuthenticationAuthority_StaleReplicaCannotRestoreAccess(t *testing.T) {
	tokens := newAuthorityTokens(t)
	ctx := context.Background()
	for _, scenario := range []struct {
		name, query string
		args        []any
		paths       []string
	}{
		{"session-version", `UPDATE auth_token_sessions SET "accessVersion" = "accessVersion" + 1 WHERE "userId" = $1`, []any{tokens.userID}, []string{"user", "user-unified"}},
		{"session-deleted", `DELETE FROM auth_token_sessions WHERE "userId" = $1`, []any{tokens.userID}, []string{"user", "user-unified"}},
		{"user-locked", `UPDATE users SET "isLocked" = true WHERE id = $1`, []any{tokens.userID}, []string{"user", "user-unified"}},
		{"user-temporarily-locked", `UPDATE users SET "temporaryLockDateEnd" = NOW() + interval '1 hour' WHERE id = $1`, []any{tokens.userID}, []string{"user", "user-unified"}},
		{"user-unaccepted", `UPDATE users SET "isAccepted" = false WHERE id = $1`, []any{tokens.userID}, []string{"user", "user-unified"}},
		{"user-membership", `UPDATE memberships SET "isActive" = false WHERE "actorUserId" = $1 AND scope = 'organization'`, []any{tokens.userID}, []string{"user", "user-unified"}},
		{"identity-membership", `UPDATE memberships SET "isActive" = false WHERE "actorIdentityId" = $1 AND scope = 'organization'`, []any{tokens.identityID}, []string{"identity", "identity-unified", "legacy", "legacy-unified"}},
		{"organization-deleted", `DELETE FROM organizations WHERE id = $1`, []any{tokens.orgID}, []string{"user", "user-unified", "legacy", "legacy-unified", "service"}},
		{"legacy-revoked", `UPDATE identity_access_tokens SET "isAccessTokenRevoked" = true WHERE id = $1`, []any{tokens.tokenID}, []string{"legacy", "legacy-unified"}},
		{"trusted-ip-restricted", `UPDATE identity_universal_auths SET "accessTokenTrustedIps" = '[{"ipAddress":"192.0.2.1","type":"ipv4"}]'::jsonb WHERE "identityId" = $1`, []any{tokens.identityID}, []string{"identity", "identity-unified", "legacy", "legacy-unified"}},
		{"service-token-deleted", `DELETE FROM service_tokens WHERE id = $1`, []any{tokens.serviceID}, []string{"service"}},
		{"service-project-deleted", `DELETE FROM projects WHERE id = $1`, []any{tokens.projectID}, []string{"service"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			db, validator := newAuthorityValidator(t)
			for _, path := range scenario.paths {
				identity, err := tokens.validate(ctx, validator, path)
				require.NoError(t, err, "valid control for %s", path)
				require.NotNil(t, identity)
			}
			tag, err := db.primary.Exec(ctx, scenario.query, scenario.args...)
			require.NoError(t, err)
			require.Positive(t, tag.RowsAffected())
			staleReplica := db.replica
			db.replica = db.primary
			for _, path := range scenario.paths {
				identity, err := tokens.validate(ctx, validator, path)
				require.Error(t, err, "primary-only control must deny the changed state")
				require.Nil(t, identity)
			}
			db.replica = staleReplica
			for _, path := range scenario.paths {
				t.Run(path, func(t *testing.T) {
					db.primaryReads, db.replicaReads = 0, 0
					identity, err := tokens.validate(ctx, validator, path)
					t.Logf("native_allowed=%t primary_reads=%d replica_reads=%d", err == nil, db.primaryReads, db.replicaReads)
					require.Error(t, err, "stale replica must not restore access")
					require.Nil(t, identity)
					require.Zero(t, db.replicaReads)
				})
			}
		})
	}
}

func TestAuthenticationAuthority_PrimaryFailureNeverFallsBack(t *testing.T) {
	tokens := newAuthorityTokens(t)
	ctx := context.Background()
	for _, flow := range []struct {
		path  string
		reads int
	}{{"user", 4}, {"user-unified", 4}, {"identity", 3}, {"identity-unified", 3}, {"legacy", 5}, {"legacy-unified", 5}, {"service", 3}} {
		t.Run(flow.path, func(t *testing.T) {
			db, validator := newAuthorityValidator(t)
			identity, err := tokens.validate(ctx, validator, flow.path)
			require.NoError(t, err)
			require.NotNil(t, identity)
			for failAt := 1; failAt <= flow.reads; failAt++ {
				t.Run(fmt.Sprintf("read-%d", failAt), func(t *testing.T) {
					db.primaryReads, db.replicaReads, db.failAt = 0, 0, failAt
					identity, err := tokens.validate(ctx, validator, flow.path)
					require.Error(t, err)
					require.Nil(t, identity)
					require.Zero(t, db.replicaReads)
					require.Equal(t, failAt, db.primaryReads)
				})
			}
		})
	}
}

func TestAuthenticationAuthority_GroupRevocationUsesPrimary(t *testing.T) {
	tokens := newAuthorityTokens(t)
	ctx := context.Background()
	for _, actor := range []struct {
		name, id, column, table, link string
		paths                         []string
	}{
		{"user", tokens.userID, "actorUserId", "user_group_membership", "userId", []string{"user", "user-unified"}},
		{"identity", tokens.identityID, "actorIdentityId", "identity_group_membership", "identityId", []string{"identity", "identity-unified"}},
	} {
		for _, revoke := range []string{"group-link", "group-membership"} {
			t.Run(actor.name+"-"+revoke, func(t *testing.T) {
				db, validator := newAuthorityValidator(t)
				groupID, membershipID := uuid.New(), uuid.New()
				for _, pool := range []*pgxpool.Pool{db.primary, db.replica} {
					_, err := pool.Exec(ctx, `DELETE FROM memberships WHERE `+pgx.Identifier{actor.column}.Sanitize()+` = $1 AND scope = 'organization'`, actor.id)
					require.NoError(t, err)
					_, err = pool.Exec(ctx, "DELETE FROM "+pgx.Identifier{actor.table}.Sanitize()+" WHERE "+pgx.Identifier{actor.link}.Sanitize()+" = $1", actor.id)
					require.NoError(t, err)
					_, err = pool.Exec(ctx, `INSERT INTO groups (id, name) VALUES ($1, 'authority-group-fixture')`, groupID)
					require.NoError(t, err)
					_, err = pool.Exec(ctx, "INSERT INTO "+pgx.Identifier{actor.table}.Sanitize()+" (id, \"groupId\", "+pgx.Identifier{actor.link}.Sanitize()+") VALUES ($1, $2, $3)", uuid.New(), groupID, actor.id)
					require.NoError(t, err)
					_, err = pool.Exec(ctx, `INSERT INTO memberships (id, "actorGroupId", scope, "scopeOrgId", "isActive", status)
						VALUES ($1, $2, 'organization', $3, true, 'accepted')`, membershipID, groupID, tokens.orgID)
					require.NoError(t, err)
				}
				for _, path := range actor.paths {
					identity, err := tokens.validate(ctx, validator, path)
					require.NoError(t, err, "group-only valid control")
					require.NotNil(t, identity)
				}
				if revoke == "group-link" {
					_, err := db.primary.Exec(ctx, "DELETE FROM "+pgx.Identifier{actor.table}.Sanitize()+" WHERE \"groupId\" = $1", groupID)
					require.NoError(t, err)
				} else {
					_, err := db.primary.Exec(ctx, `UPDATE memberships SET "isActive" = false WHERE id = $1`, membershipID)
					require.NoError(t, err)
				}
				for _, path := range actor.paths {
					t.Run(path, func(t *testing.T) {
						db.primaryReads, db.replicaReads = 0, 0
						identity, err := tokens.validate(ctx, validator, path)
						require.Error(t, err)
						require.Nil(t, identity)
						require.Zero(t, db.replicaReads)
					})
				}
			})
		}
	}
}

func TestAuthenticationAuthority_OrganizationHierarchyUsesPrimary(t *testing.T) {
	tokens := newAuthorityTokens(t)
	ctx := context.Background()
	db, validator := newAuthorityValidator(t)
	subOrgID := uuid.New()
	claims := &apiauth.UserJWTClaims{}
	_, err := jwt.ParseWithClaims(tokens.user, claims, func(_ *jwt.Token) (any, error) {
		return []byte(infra.AuthSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	require.NoError(t, err)
	claims.SubOrganizationID = subOrgID
	tokens.user, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(infra.AuthSecret))
	require.NoError(t, err)
	for _, pool := range []*pgxpool.Pool{db.primary, db.replica} {
		_, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, "rootOrgId", "parentOrgId")
			VALUES ($1, 'authority-child-fixture', $2, $2)`, subOrgID, tokens.orgID)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `INSERT INTO memberships (id, "actorUserId", scope, "scopeOrgId", "isActive", status)
			VALUES ($1, $2, 'organization', $3, true, 'accepted')`, uuid.New(), tokens.userID, subOrgID)
		require.NoError(t, err)
	}
	for _, path := range []string{"user", "user-unified"} {
		identity, err := tokens.validate(ctx, validator, path)
		require.NoError(t, err)
		require.Equal(t, subOrgID, identity.OrgID)
	}
	_, err = db.primary.Exec(ctx, `UPDATE organizations SET "rootOrgId" = $1 WHERE id = $2`, uuid.New(), subOrgID)
	require.NoError(t, err)
	for _, path := range []string{"user", "user-unified"} {
		t.Run(path, func(t *testing.T) {
			db.primaryReads, db.replicaReads = 0, 0
			identity, err := tokens.validate(ctx, validator, path)
			require.ErrorContains(t, err, "does not belong")
			require.Nil(t, identity)
			require.Zero(t, db.replicaReads)
		})
	}
}

func TestAuthenticationAuthority_ServiceProjectTenantUsesPrimary(t *testing.T) {
	tokens := newAuthorityTokens(t)
	ctx := context.Background()
	db, validator := newAuthorityValidator(t)
	identity, err := tokens.validate(ctx, validator, "service")
	require.NoError(t, err)
	require.Equal(t, tokens.orgID, identity.OrgID.String())
	currentOrgID := uuid.New()
	for _, pool := range []*pgxpool.Pool{db.primary, db.replica} {
		_, err := pool.Exec(ctx, `INSERT INTO organizations (id, name) VALUES ($1, 'authority-tenant-fixture')`, currentOrgID)
		require.NoError(t, err)
	}
	_, err = db.primary.Exec(ctx, `UPDATE projects SET "orgId" = $1 WHERE id = $2`, currentOrgID, tokens.projectID)
	require.NoError(t, err)
	db.primaryReads, db.replicaReads = 0, 0
	identity, err = tokens.validate(ctx, validator, "service")
	require.NoError(t, err)
	require.Equal(t, currentOrgID, identity.OrgID)
	require.Equal(t, currentOrgID, identity.RootOrgID)
	require.Zero(t, db.replicaReads)
}
