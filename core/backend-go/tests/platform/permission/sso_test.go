//go:build integration

package permission_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
)

func setSSOPolicy(t *testing.T, db *pgxpool.Pool, orgID uuid.UUID, saml, google, bypass bool) {
	t.Helper()
	permissionExec(t, db, `UPDATE organizations SET "authEnforced"=$2, "googleSsoAuthEnforced"=$3, "bypassOrgAuthEnabled"=$4 WHERE id=$1`, orgID, saml, google, bypass)
}

func assertSSOAccess(t *testing.T, svc *permission.Service, args *permission.GetProjectPermissionArgs, status int) {
	t.Helper()
	result, err := svc.GetProjectPermission(context.Background(), args)
	if status == 0 {
		require.NoError(t, err)
		require.NotNil(t, result)
		return
	}
	require.Error(t, err)
	require.Nil(t, result)
	var appErr *errutil.Error
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, status, appErr.Status)
}

func TestSSOEnforcement_Methods(t *testing.T) {
	user := authorityActors(t)[0]
	for _, policy := range []struct {
		name         string
		saml, google bool
	}{
		{"disabled", false, false}, {"saml", true, false}, {"google", false, true}, {"both", true, true},
	} {
		t.Run(policy.name, func(t *testing.T) {
			db, svc := newPermissionAuthority(t, func(pool *pgxpool.Pool) { setSSOPolicy(t, pool, user.ActorOrgID, policy.saml, policy.google, false) })
			for _, method := range []string{"email", "google", "github", "gitlab", "ldap", "oidc", "azure-saml", "okta-saml", "jumpcloud-saml", "google-saml", "keycloak-saml", "unknown", ""} {
				t.Run("method-"+method, func(t *testing.T) {
					args := user
					args.ActorAuthMethod = auth.ActorAuthMethod(method)
					status := 0
					isSaml := method == "oidc" || method == "azure-saml" || method == "okta-saml" || method == "jumpcloud-saml" || method == "google-saml" || method == "keycloak-saml"
					if (policy.saml && !isSaml) || (policy.google && method != "google") {
						status = 403
					}
					if (policy.saml || policy.google) && method == "" {
						status = 401
					}
					assertSSOAccess(t, svc, &args, status)
					require.Zero(t, db.replicaReads)
				})
			}
		})
	}
}

func TestSSOEnforcement_BypassAuthority(t *testing.T) {
	user := authorityActors(t)[0]
	user.ActorAuthMethod = "email"
	for _, name := range []string{"admin", "google-admin", "both-admin", "project-admin-only", "disabled-switch", "missing-method", "custom-allow", "custom-deny", "expired-role", "temporary-role", "additional-grant", "expired-additional", "group-admin", "inactive-group", "inactive-membership", "invalid-rules", "root-admin", "child-admin-only"} {
		t.Run(name, func(t *testing.T) {
			args := user
			status := 0
			db, svc := newPermissionAuthority(t, func(pool *pgxpool.Pool) {
				setSSOPolicy(t, pool, user.ActorOrgID, true, false, true)
				orgRoleWhere := ` WHERE "membershipId" IN (SELECT id FROM memberships WHERE scope='organization' AND "scopeOrgId"=$1 AND "actorUserId"=$2)`
				role := func(value string) {
					permissionExec(t, pool, `UPDATE membership_roles SET role=$3`+orgRoleWhere, user.ActorOrgID, user.ActorID, value)
				}
				custom := func(rules string, keepAdmin bool) {
					id := uuid.New()
					permissionExec(t, pool, `INSERT INTO roles (id,slug,permissions) VALUES ($1,'sso-test',$2)`, id, rules)
					if keepAdmin {
						permissionExec(t, pool, `INSERT INTO membership_roles (id,"membershipId",role,"customRoleId") SELECT $3,id,'custom',$4 FROM memberships WHERE scope='organization' AND "scopeOrgId"=$1 AND "actorUserId"=$2`, user.ActorOrgID, user.ActorID, uuid.New(), id)
					} else {
						permissionExec(t, pool, `UPDATE membership_roles SET role='custom',"customRoleId"=$3`+orgRoleWhere, user.ActorOrgID, user.ActorID, id)
					}
				}
				switch name {
				case "google-admin":
					setSSOPolicy(t, pool, user.ActorOrgID, false, true, true)
				case "both-admin":
					setSSOPolicy(t, pool, user.ActorOrgID, true, true, true)
				case "project-admin-only":
					role("member")
					status = 403
				case "disabled-switch":
					setSSOPolicy(t, pool, user.ActorOrgID, true, false, false)
					status = 403
				case "missing-method":
					args.ActorAuthMethod = ""
					status = 401
				case "custom-allow":
					custom(`[["bypass-sso-enforcement","sso"]]`, false)
				case "custom-deny":
					custom(`[["bypass-sso-enforcement","sso",0,1]]`, true)
					status = 403
				case "invalid-rules":
					custom(`{}`, true)
					status = 500
				case "expired-role", "temporary-role":
					end := "NOW() + interval '1 hour'"
					if name == "expired-role" {
						end = "NOW() - interval '1 second'"
						status = 403
					}
					permissionExec(t, pool, `UPDATE membership_roles SET "isTemporary"=true,"temporaryAccessEndTime"=`+end+orgRoleWhere, user.ActorOrgID, user.ActorID)
				case "additional-grant", "expired-additional":
					role("member")
					permissionExec(t, pool, `INSERT INTO additional_privileges (id,"actorUserId","orgId",permissions,"isTemporary","temporaryAccessEndTime") VALUES ($1,$2,$3,'[["bypass-sso-enforcement","sso"]]',true,NOW()+interval '1 hour')`, uuid.New(), user.ActorID, user.ActorOrgID)
					if name == "expired-additional" {
						permissionExec(t, pool, `UPDATE additional_privileges SET "temporaryAccessEndTime"=NOW()-interval '1 second' WHERE "actorUserId"=$1`, user.ActorID)
						status = 403
					}
				case "group-admin", "inactive-group":
					id := uuid.New()
					permissionExec(t, pool, `INSERT INTO groups (id) VALUES ($1)`, id)
					permissionExec(t, pool, `INSERT INTO user_group_membership ("groupId","userId") VALUES ($1,$2)`, id, user.ActorID)
					permissionExec(t, pool, `UPDATE memberships SET "actorGroupId"=$3,"actorUserId"=NULL WHERE scope='organization' AND "scopeOrgId"=$1 AND "actorUserId"=$2`, user.ActorOrgID, user.ActorID, id)
					if name == "inactive-group" {
						permissionExec(t, pool, `UPDATE memberships SET "isActive"=false WHERE "actorGroupId"=$1`, id)
						status = 403
					}
				case "inactive-membership":
					permissionExec(t, pool, `UPDATE memberships SET "isActive"=false WHERE scope='organization' AND "scopeOrgId"=$1 AND "actorUserId"=$2`, user.ActorOrgID, user.ActorID)
					status = 403
				case "root-admin", "child-admin-only":
					child := uuid.New()
					permissionExec(t, pool, `INSERT INTO organizations SELECT (jsonb_populate_record(NULL::organizations,to_jsonb(o)||jsonb_build_object('id',$2::text,'rootOrgId',o.id))).* FROM organizations o WHERE id=$1`, user.ActorOrgID, child)
					permissionExec(t, pool, `UPDATE projects SET "orgId"=$2 WHERE id=$1`, user.ProjectID, child)
					permissionExec(t, pool, `UPDATE memberships SET "scopeOrgId"=$2 WHERE "scopeProjectId"=$1`, user.ProjectID, child)
					membership := uuid.New()
					permissionExec(t, pool, `INSERT INTO memberships (id,scope,"scopeOrgId","actorUserId","isActive") VALUES ($1,'organization',$2,$3,true)`, membership, child, user.ActorID)
					permissionExec(t, pool, `INSERT INTO membership_roles (id,"membershipId",role) VALUES ($1,$2,'admin')`, uuid.New(), membership)
					if name == "child-admin-only" {
						role("member")
						status = 403
					}
					args.ActorOrgID = child
				}
			})
			assertSSOAccess(t, svc, &args, status)
			require.Zero(t, db.replicaReads)
		})
	}
}

func TestSSOEnforcement_RevocationAndFailure(t *testing.T) {
	user := authorityActors(t)[0]
	user.ActorAuthMethod = "email"
	for _, name := range []string{"enforcement-enabled", "bypass-disabled", "role-revoked", "membership-disabled", "group-link-removed", "primary-failure"} {
		t.Run(name, func(t *testing.T) {
			db, svc := newPermissionAuthority(t, func(pool *pgxpool.Pool) {
				setSSOPolicy(t, pool, user.ActorOrgID, name != "enforcement-enabled", false, name != "enforcement-enabled")
				if name == "group-link-removed" {
					id := uuid.New()
					permissionExec(t, pool, `INSERT INTO groups (id) VALUES ($1)`, id)
					permissionExec(t, pool, `INSERT INTO user_group_membership ("groupId","userId") VALUES ($1,$2)`, id, user.ActorID)
					permissionExec(t, pool, `UPDATE memberships SET "actorGroupId"=$3,"actorUserId"=NULL WHERE scope='organization' AND "scopeOrgId"=$1 AND "actorUserId"=$2`, user.ActorOrgID, user.ActorID, id)
				}
			})
			assertSSOAccess(t, svc, &user, 0)
			switch name {
			case "enforcement-enabled":
				setSSOPolicy(t, db.primary, user.ActorOrgID, true, false, false)
			case "bypass-disabled":
				setSSOPolicy(t, db.primary, user.ActorOrgID, true, false, false)
			case "role-revoked":
				permissionExec(t, db.primary, `UPDATE membership_roles SET role='member' WHERE "membershipId" IN (SELECT id FROM memberships WHERE scope='organization' AND "actorUserId"=$1)`, user.ActorID)
			case "membership-disabled":
				permissionExec(t, db.primary, `UPDATE memberships SET "isActive"=false WHERE scope='organization' AND "actorUserId"=$1`, user.ActorID)
			case "group-link-removed":
				permissionExec(t, db.primary, `DELETE FROM user_group_membership WHERE "userId"=$1`, user.ActorID)
			case "primary-failure":
				db.primaryReads = 0
				db.failAt = 3
			}
			status := 403
			if name == "primary-failure" {
				status = 500
			}
			assertSSOAccess(t, svc, &user, status)
			require.Zero(t, db.replicaReads)
			if name == "primary-failure" {
				db.failAt = 0
				assertSSOAccess(t, svc, &user, 0)
			}
		})
	}
}

func TestSSOEnforcement_NonUserCompatibility(t *testing.T) {
	for _, actor := range authorityActors(t)[1:] {
		t.Run(string(actor.Actor), func(t *testing.T) {
			_, svc := newPermissionAuthority(t, func(pool *pgxpool.Pool) { setSSOPolicy(t, pool, actor.ActorOrgID, true, true, false) })
			assertSSOAccess(t, svc, &actor, 0)
		})
	}
}
