//go:build integration

package permission_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission/secretmanager"
)

func TestPolicyIntegrity_MalformedRoleCannotDropDenials(t *testing.T) {
	for _, actor := range authorityActors(t) {
		if actor.Actor == auth.ActorTypeService {
			continue // Service tokens have scopes, not membership role tuples.
		}
		t.Run(string(actor.Actor), func(t *testing.T) {
			column := "actorUserId"
			if actor.Actor == auth.ActorTypeIdentity {
				column = "actorIdentityId"
			}
			roleID := uuid.New()
			// The secret consumer accepts both granular readValue and the existing
			// combined read action. Deny both to constrain the admin's grants.
			valid := `[[["read","readValue"],"secrets",{"environment":"prod"},true]]`
			db, service := newPermissionAuthority(t, func(pool *pgxpool.Pool) {
				permissionExec(t, pool, `INSERT INTO roles (id, slug, permissions) VALUES ($1, 'integrity-denial', $2)`, roleID, valid)
				// Keep the existing admin role and add a scoped explicit denial.
				permissionExec(t, pool, `INSERT INTO membership_roles (id, role, "customRoleId", "membershipId", "isTemporary", "createdAt", "updatedAt")
					SELECT $3, 'custom', $4, id, false, now(), now() FROM memberships WHERE "scopeProjectId" = $1 AND "`+column+`" = $2`,
					actor.ProjectID, actor.ActorID, uuid.New(), roleID)
			})
			assertScoped := func() {
				t.Helper()
				result, err := service.GetProjectPermission(context.Background(), &actor)
				require.NoError(t, err)
				checker := secretmanager.NewSecretAccessChecker(result.Permission.Ability)
				require.False(t, checker.CanReadSecretValue("prod", "/", "SCOPED", nil))
				require.True(t, checker.CanReadSecretValue("dev", "/", "SCOPED", nil))
			}
			assertScoped()
			for _, malformed := range []string{`[["readValue","secrets",42,true]]`, `[["readValue","secrets",{},"deny"]]`} {
				permissionExec(t, db.primary, `UPDATE roles SET permissions = $2 WHERE id = $1`, roleID, malformed)
				result, err := service.GetProjectPermission(context.Background(), &actor)
				require.Error(t, err, "malformed denial must invalidate the complete authority, including other grants")
				require.Nil(t, result)
				permissionExec(t, db.primary, `UPDATE roles SET permissions = $2 WHERE id = $1`, roleID, valid)
				assertScoped()
			}
			// PostgreSQL rejects non-JSON before a role can be persisted. Verify
			// that boundary and that rejection leaves the valid denial intact.
			_, err := db.primary.Exec(context.Background(), `UPDATE roles SET permissions = $2 WHERE id = $1`, roleID, `not json`)
			var jsonError *pgconn.PgError
			require.ErrorAs(t, err, &jsonError)
			require.Equal(t, "22P02", jsonError.Code)
			assertScoped()
		})
	}
}
