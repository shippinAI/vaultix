//go:build integration

package auth_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/tests/infra"
)

// Insertion order exposes the baseline's unordered lookup in these schema
// fixtures. It is not a guarantee about a production PostgreSQL query plan.
func TestAuthenticationMembership_DirectPrecedence(t *testing.T) {
	tokens := newAuthorityTokens(t)
	ctx := context.Background()
	for _, actor := range []struct {
		name, id, column, table, link string
		paths                         []string
	}{
		{"user", tokens.userID, "actorUserId", "user_group_membership", "userId", []string{"user", "user-unified"}},
		{"identity", tokens.identityID, "actorIdentityId", "identity_group_membership", "identityId", []string{"identity", "identity-unified", "legacy", "legacy-unified"}},
	} {
		for _, scenario := range []struct {
			name, directKind, status, groupKind string
			directActive, groupActive, allow    bool
		}{
			{"active-direct", "organization", "accepted", "linked", true, false, true},
			{"inactive-direct", "organization", "accepted", "linked", false, true, false},
			{"null-status-active-direct", "organization", "", "linked", true, false, true},
			{"null-status-inactive-direct", "organization", "", "linked", false, true, false},
			{"invited-active-direct", "organization", "invited", "linked", true, false, false},
			{"invited-inactive-direct", "organization", "invited", "linked", false, true, true},
			{"active-group-only", "none", "accepted", "linked", false, true, true},
			{"inactive-group-only", "none", "accepted", "linked", false, false, false},
			{"project-direct-ignored", "project", "accepted", "linked", false, true, true},
			{"other-tenant-direct-ignored", "other-org", "accepted", "linked", true, false, false},
			{"unrelated-group-ignored", "organization", "accepted", "unrelated", false, true, false},
			{"active-direct-only", "organization", "accepted", "none", true, false, true},
			{"no-membership", "none", "accepted", "none", false, false, false},
		} {
			t.Run(actor.name+"/"+scenario.name, func(t *testing.T) {
				db, validator := newAuthorityValidator(t)
				for _, path := range actor.paths {
					identity, err := tokens.validate(ctx, validator, path)
					require.NoError(t, err, "unchanged valid control")
					require.NotNil(t, identity)
				}
				_, err := db.primary.Exec(ctx, "DELETE FROM memberships WHERE "+pgx.Identifier{actor.column}.Sanitize()+" = $1", actor.id)
				require.NoError(t, err)
				_, err = db.primary.Exec(ctx, "DELETE FROM "+pgx.Identifier{actor.table}.Sanitize()+" WHERE "+pgx.Identifier{actor.link}.Sanitize()+" = $1", actor.id)
				require.NoError(t, err)
				if scenario.groupKind != "none" {
					groupID := uuid.New()
					linkID := actor.id
					if scenario.groupKind == "unrelated" {
						linkID = uuid.NewString()
					}
					_, err = db.primary.Exec(ctx, `INSERT INTO groups (id, name) VALUES ($1, 'membership-precedence-fixture')`, groupID)
					require.NoError(t, err)
					_, err = db.primary.Exec(ctx, "INSERT INTO "+pgx.Identifier{actor.table}.Sanitize()+" (id, \"groupId\", "+pgx.Identifier{actor.link}.Sanitize()+") VALUES ($1, $2, $3)", uuid.New(), groupID, linkID)
					require.NoError(t, err)
					_, err = db.primary.Exec(ctx, `INSERT INTO memberships (id, "actorGroupId", scope, "scopeOrgId", "isActive", status)
						VALUES ($1, $2, 'organization', $3, $4, 'accepted')`, uuid.New(), groupID, tokens.orgID, scenario.groupActive)
					require.NoError(t, err)
				}
				if scenario.directKind != "none" {
					scope, orgID := "organization", tokens.orgID
					if scenario.directKind == "project" {
						scope = "project"
					}
					if scenario.directKind == "other-org" {
						orgID = uuid.NewString()
					}
					var status any
					if scenario.status != "" {
						status = scenario.status
					}
					_, err = db.primary.Exec(ctx, "INSERT INTO memberships (id, "+pgx.Identifier{actor.column}.Sanitize()+`, scope, "scopeOrgId", "isActive", status)
						VALUES ($1, $2, $3, $4, $5, $6)`, uuid.New(), actor.id, scope, orgID, scenario.directActive, status)
					require.NoError(t, err)
				}
				for _, path := range actor.paths {
					t.Run(path, func(t *testing.T) {
						db.primaryReads, db.replicaReads = 0, 0
						identity, err := tokens.validate(ctx, validator, path)
						t.Logf("membership_allowed=%t expected_allowed=%t", err == nil, scenario.allow)
						if scenario.allow {
							require.NoError(t, err)
							require.NotNil(t, identity)
							require.Equal(t, actor.id, identity.ActorID.String())
						} else {
							require.Error(t, err)
							require.Nil(t, identity)
						}
						require.Zero(t, db.replicaReads)
					})
				}
			})
		}
	}
}

// Group linking and deactivate/reactivate operations use real issuer APIs.
// User acceptance and its session/JWT are explicit fixtures, not a sign-in test.
func TestAuthenticationMembership_UserLifecycle(t *testing.T) {
	ctx := context.Background()
	node := stack.NodeJS()
	user := node.InviteAndCreateUser(t, "membership-"+uuid.NewString()+"@test.com")
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(ctx, `DELETE FROM users WHERE id = $1`, user.ID)
		require.NoError(t, err)
	})
	_, err := stack.DB().Primary().Exec(ctx, `UPDATE users SET "isAccepted" = true WHERE id = $1`, user.ID)
	require.NoError(t, err)
	var membershipID string
	err = stack.DB().Primary().QueryRow(ctx, `UPDATE memberships SET status = 'accepted'
		WHERE "actorUserId" = $1 AND scope = 'organization' AND "scopeOrgId" = $2 RETURNING id`, user.ID, node.OrgID()).Scan(&membershipID)
	require.NoError(t, err)
	sessionID := uuid.New()
	_, err = stack.DB().Primary().Exec(ctx, `INSERT INTO auth_token_sessions
		(id, "userId", "accessVersion", "refreshVersion", ip, "userAgent", "lastUsed", "createdAt", "updatedAt")
		VALUES ($1, $2, 1, 1, '127.0.0.1', 'membership-fixture', NOW(), NOW(), NOW())`, sessionID, user.ID)
	require.NoError(t, err)
	// Omit the optional sub-organization claim. The native parsing struct's
	// zero UUID serializes as a real string, which the issuer treats as a scope.
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"authTokenType": auth.AuthTokenTypeAccessToken, "authMethod": "email",
		"userId": user.ID, "tokenVersionId": sessionID.String(), "accessVersion": 1,
		"organizationId": node.OrgID(), "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(infra.AuthSecret))
	require.NoError(t, err)
	group := node.CreateGroup(t, "membership-"+uuid.NewString()[:8])
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(ctx, `DELETE FROM groups WHERE id = $1`, group.ID)
		require.NoError(t, err)
	})
	node.AddUserToGroup(t, group.ID, user.Email)
	for _, step := range []struct {
		name           string
		active, update bool
	}{{"initial", true, false}, {"deactivated", false, true}, {"reactivated", true, true}} {
		t.Run(step.name, func(t *testing.T) {
			if step.update {
				r, err := node.Client().R().SetAuthToken(node.UserToken()).SetBody(map[string]bool{"isActive": step.active}).
					Patch("/api/v2/organizations/" + node.OrgID() + "/memberships/" + membershipID)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, r.StatusCode())
			}
			var groupActive bool
			err := stack.DB().Primary().QueryRow(ctx, `SELECT m."isActive" FROM memberships m
				JOIN user_group_membership link ON link."groupId" = m."actorGroupId"
				WHERE m."actorGroupId" = $1 AND link."userId" = $2 AND m.scope = 'organization' AND m."scopeOrgId" = $3`,
				group.ID, user.ID, node.OrgID()).Scan(&groupActive)
			require.NoError(t, err)
			require.True(t, groupActive, "direct lifecycle must leave the active group linked")
			r, err := node.Client().R().SetAuthToken(token).Get("/api/v1/organization")
			require.NoError(t, err)
			if step.active {
				require.Equal(t, http.StatusOK, r.StatusCode())
			} else {
				require.Equal(t, http.StatusForbidden, r.StatusCode())
			}
			for _, unified := range []bool{false, true} {
				if unified {
					_, _, err = authenticator.ValidateJWTToken(ctx, token, "127.0.0.1")
				} else {
					_, err = authenticator.ValidateJWT(ctx, token)
				}
				if step.active {
					require.NoError(t, err)
				} else {
					require.ErrorContains(t, err, "inactive")
				}
			}
		})
	}
}
