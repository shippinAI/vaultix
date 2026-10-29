//go:build integration

package permission_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
	"github.com/vaultix/api/internal/services/permission/secretmanager"
	"github.com/vaultix/api/tests/infra"
)

// Two isolated schema copies model committed primary state and a frozen replica.
// They do not model physical replication or modify the operator's database.
type permissionAuthorityDB struct {
	primary, replica, unavailable      *pgxpool.Pool
	primaryReads, replicaReads, failAt int
}

func (db *permissionAuthorityDB) Primary() *pgxpool.Pool {
	db.primaryReads++
	if db.failAt > 0 && db.primaryReads == db.failAt {
		return db.unavailable
	}
	return db.primary
}
func (db *permissionAuthorityDB) Replica() *pgxpool.Pool { db.replicaReads++; return db.replica }
func (db *permissionAuthorityDB) ReplicaCount() int      { return 1 }
func (db *permissionAuthorityDB) Close()                 {} // Pools belong to the test.

func copyPermissionPool(t *testing.T, source *pgxpool.Pool) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	schema := pgx.Identifier{"permission_" + strings.ReplaceAll(uuid.NewString(), "-", "")}.Sanitize()
	_, err := source.Exec(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		require.NoError(t, err)
	})
	for _, table := range []string{"projects", "organizations", "memberships", "membership_roles", "roles",
		"groups", "user_group_membership", "identity_group_membership", "additional_privileges",
		"identity_metadata", "users", "identities", "service_tokens"} {
		name := pgx.Identifier{table}.Sanitize()
		_, err := source.Exec(ctx, "CREATE TABLE "+schema+"."+name+" AS SELECT * FROM "+name)
		require.NoError(t, err)
	}
	cfg := source.Config()
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, pool.Ping(ctx))
	return pool
}

func permissionExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	tag, err := pool.Exec(context.Background(), query, args...)
	require.NoError(t, err)
	require.Positive(t, tag.RowsAffected(), "fixture mutation must affect state")
}

func newPermissionAuthority(t *testing.T, prepare func(*pgxpool.Pool)) (*permissionAuthorityDB, *permission.Service) {
	t.Helper()
	db := &permissionAuthorityDB{primary: copyPermissionPool(t, stack.DB().Primary())}
	if prepare != nil {
		prepare(db.primary)
	}
	db.replica = copyPermissionPool(t, db.primary)
	closed, err := pgxpool.NewWithConfig(context.Background(), db.primary.Config())
	require.NoError(t, err)
	closed.Close()
	db.unavailable = closed
	svc := permission.NewService(context.Background(), infra.NopLogger(), &permission.Deps{DB: db})
	return db, svc
}

func authorityActors(t *testing.T) []permission.GetProjectPermissionArgs {
	t.Helper()
	node := stack.NodeJS()
	project := node.CreateProject(t, "perm-auth-"+uuid.NewString()[:8])
	t.Cleanup(func() { node.DeleteProject(t, project.ID) })
	identity := node.CreateIdentity(t, "permission-authority-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	node.AddIdentityToProject(t, project.ID, identity.ID, infra.Role("admin"))
	service := node.CreateServiceToken(t, project.ID, nil)
	t.Cleanup(func() { node.DeleteServiceToken(t, service.ID) })
	var actors []permission.GetProjectPermissionArgs
	for _, actor := range []struct {
		kind auth.ActorType
		id   string
	}{
		{auth.ActorTypeUser, node.UserID()}, {auth.ActorTypeIdentity, identity.ID}, {auth.ActorTypeService, service.ID},
	} {
		actors = append(actors, permission.GetProjectPermissionArgs{Actor: actor.kind, ActorID: uuid.MustParse(actor.id),
			ProjectID: project.ID, ActorOrgID: uuid.MustParse(node.OrgID()), ActionProjectType: permission.ActionProjectTypeSecretManager})
	}
	return actors
}

func assertPermissionState(t *testing.T, svc *permission.Service, args *permission.GetProjectPermissionArgs, denied, absent bool) {
	t.Helper()
	result, err := svc.GetProjectPermission(context.Background(), args)
	if absent {
		require.Error(t, err)
		require.Nil(t, result)
		return
	}
	require.NoError(t, err)
	require.NotNil(t, result)
	checker := secretmanager.NewSecretAccessChecker(result.Permission.Ability)
	require.Equal(t, !denied, checker.CanDescribeSecret("dev", "/", "ALLOWED", nil))
}

func TestPermissionAuthority_StaleReplicaCannotRestoreAccess(t *testing.T) {
	actors := authorityActors(t)
	for _, actor := range actors {
		t.Run(string(actor.Actor), func(t *testing.T) {
			type scenario struct {
				name    string
				prepare func(*pgxpool.Pool)
				change  func(*pgxpool.Pool)
				absent  bool
			}
			cases := []scenario{
				{name: "project-deleted", absent: true, change: func(pool *pgxpool.Pool) {
					permissionExec(t, pool, `DELETE FROM projects WHERE id = $1`, actor.ProjectID)
				}},
				{name: "project-tenant", absent: true, change: func(pool *pgxpool.Pool) {
					permissionExec(t, pool, `UPDATE projects SET "orgId" = $2 WHERE id = $1`, actor.ProjectID, uuid.New())
				}},
				{name: "project-type", absent: true, change: func(pool *pgxpool.Pool) {
					permissionExec(t, pool, `UPDATE projects SET type = 'kms' WHERE id = $1`, actor.ProjectID)
				}},
			}
			if actor.Actor == auth.ActorTypeService {
				cases = append(cases,
					scenario{name: "token-deleted", absent: true, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `DELETE FROM service_tokens WHERE id = $1`, actor.ActorID)
					}},
					scenario{name: "token-scope", change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `UPDATE service_tokens SET scopes = '[]' WHERE id = $1`, actor.ActorID)
					}},
					scenario{name: "token-permissions", change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `UPDATE service_tokens SET permissions = ARRAY['write'] WHERE id = $1`, actor.ActorID)
					}},
				)
			} else {
				column, linkTable, linkColumn, nameTable, nameColumn := "actorUserId", "user_group_membership", "userId", "users", "username"
				if actor.Actor == auth.ActorTypeIdentity {
					column, linkTable, linkColumn, nameTable, nameColumn = "actorIdentityId", "identity_group_membership", "identityId", "identities", "name"
				}
				membership := `SELECT id FROM memberships WHERE "scopeProjectId" = $1 AND "` + column + `" = $2`
				roleWhere := ` WHERE "membershipId" IN (` + membership + `)`
				roleUpdate := func(pool *pgxpool.Pool, set string) {
					permissionExec(t, pool, `UPDATE membership_roles SET `+set+roleWhere, actor.ProjectID, actor.ActorID)
				}
				custom := func(pool *pgxpool.Pool, rules string) {
					roleID := uuid.New()
					permissionExec(t, pool, `INSERT INTO roles (id, slug, permissions) VALUES ($1, 'authority-custom', $2)`, roleID, rules)
					permissionExec(t, pool, `UPDATE membership_roles SET role = 'custom', "customRoleId" = $3`+roleWhere, actor.ProjectID, actor.ActorID, roleID)
				}
				group := func(pool *pgxpool.Pool) {
					id := uuid.New()
					permissionExec(t, pool, `INSERT INTO groups (id) VALUES ($1)`, id)
					permissionExec(t, pool, `INSERT INTO `+linkTable+` ("groupId", "`+linkColumn+`") VALUES ($1, $2)`, id, actor.ActorID)
					permissionExec(t, pool, `UPDATE memberships SET "actorGroupId" = $3, "`+column+`" = NULL WHERE id IN (`+membership+`)`, actor.ProjectID, actor.ActorID, id)
				}
				cases = append(cases,
					scenario{name: "membership-deleted", absent: true, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `DELETE FROM memberships WHERE id IN (`+membership+`)`, actor.ProjectID, actor.ActorID)
					}},
					scenario{name: "role-removed", change: func(pool *pgxpool.Pool) { roleUpdate(pool, `role = 'no-access'`) }},
					scenario{name: "temporary-role-shortened", change: func(pool *pgxpool.Pool) {
						roleUpdate(pool, `"isTemporary" = true, "temporaryAccessEndTime" = NOW() - interval '1 second'`)
					}},
					scenario{name: "custom-role-revoked", prepare: func(pool *pgxpool.Pool) { custom(pool, `[["read","secrets"]]`) }, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `UPDATE roles SET permissions = '[]' WHERE slug = 'authority-custom'`)
					}},
					scenario{name: "group-link-removed", absent: true, prepare: group, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `DELETE FROM `+linkTable+` WHERE "`+linkColumn+`" = $1`, actor.ActorID)
					}},
					scenario{name: "group-project-removed", absent: true, prepare: group, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `DELETE FROM memberships WHERE "scopeProjectId" = $1 AND "actorGroupId" IS NOT NULL`, actor.ProjectID)
					}},
					scenario{name: "name-template-changed", prepare: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `UPDATE `+nameTable+` SET `+nameColumn+` = 'ALLOWED' WHERE id = $1`, actor.ActorID)
						custom(pool, `[["read","secrets",{"secretName":"{{identity.username}}"}]]`)
					}, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `UPDATE `+nameTable+` SET `+nameColumn+` = 'REVOKED' WHERE id = $1`, actor.ActorID)
					}},
					scenario{name: "metadata-template-changed", prepare: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `INSERT INTO identity_metadata (id, "`+linkColumn+`", "orgId", key, value) VALUES ($1, $2, $3, 'scope', 'ALLOWED')`, uuid.New(), actor.ActorID, actor.ActorOrgID)
						custom(pool, `[["read","secrets",{"secretName":"{{identity.metadata.scope}}"}]]`)
					}, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `UPDATE identity_metadata SET value = 'REVOKED' WHERE "`+linkColumn+`" = $1 AND key = 'scope'`, actor.ActorID)
					}},
					scenario{name: "additional-grant-removed", prepare: func(pool *pgxpool.Pool) {
						roleUpdate(pool, `role = 'no-access'`)
						permissionExec(t, pool, `INSERT INTO additional_privileges (id, "`+column+`", "projectId", permissions) VALUES ($1, $2, $3, '[["read","secrets"]]')`, uuid.New(), actor.ActorID, actor.ProjectID)
					}, change: func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `DELETE FROM additional_privileges WHERE "`+column+`" = $1 AND "projectId" = $2`, actor.ActorID, actor.ProjectID)
					}},
				)
			}
			for _, test := range cases {
				t.Run(test.name, func(t *testing.T) {
					db, svc := newPermissionAuthority(t, test.prepare)
					assertPermissionState(t, svc, &actor, false, false)
					test.change(db.primary)
					stale := db.replica
					db.replica = db.primary
					assertPermissionState(t, svc, &actor, true, test.absent) // Primary-only control.
					db.replica = stale
					db.primaryReads, db.replicaReads = 0, 0
					assertPermissionState(t, svc, &actor, true, test.absent)
					require.Zero(t, db.replicaReads)
				})
			}
		})
	}
}

func TestPermissionAuthority_EnforcementAndAvailability(t *testing.T) {
	for _, actor := range authorityActors(t) {
		t.Run(string(actor.Actor), func(t *testing.T) {
			db, svc := newPermissionAuthority(t, nil)
			result, err := svc.GetProjectPermission(context.Background(), &actor)
			require.NoError(t, err)
			require.False(t, result.HasProjectEnforcement("enforceEncryptedSecretManagerSecretMetadata"))
			permissionExec(t, db.primary, `UPDATE projects SET "enforceEncryptedSecretManagerSecretMetadata" = true WHERE id = $1`, actor.ProjectID)
			result, err = svc.GetProjectPermission(context.Background(), &actor)
			require.NoError(t, err)
			require.True(t, result.HasProjectEnforcement("enforceEncryptedSecretManagerSecretMetadata"))
			reads := 3
			if actor.Actor == auth.ActorTypeService {
				reads = 2
			}
			for failAt := 1; failAt <= reads; failAt++ {
				t.Run(fmt.Sprintf("primary-failure-%d", failAt), func(t *testing.T) {
					db.primaryReads, db.replicaReads, db.failAt = 0, 0, failAt
					result, err := svc.GetProjectPermission(context.Background(), &actor)
					require.Error(t, err)
					require.Nil(t, result)
					require.Zero(t, db.replicaReads)
					require.Equal(t, failAt, db.primaryReads)
				})
			}
			db.failAt = 0
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			result, err = svc.GetProjectPermission(ctx, &actor)
			require.Error(t, err)
			require.Nil(t, result)
			assertPermissionState(t, svc, &actor, false, false) // Available primary recovers.
		})
	}
}
