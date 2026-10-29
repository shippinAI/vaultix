//go:build integration

package secrets_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/secretmanager/reference"
	"github.com/vaultix/api/tests/infra"
)

func TestReference_ProjectMembershipDifferential(t *testing.T) {
	node := stack.NodeJS()
	project := node.CreateProject(t, "discovery-"+uuid.NewString()[:8])
	t.Cleanup(func() { node.DeleteProject(t, project.ID) })
	identity := node.CreateIdentity(t, "discovery-"+uuid.NewString()[:8])
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	token := node.GetIdentityAccessToken(t, identity.ID)
	identityCtx := referenceContext(t, auth.ActorTypeIdentity, identity.ID)
	userCtx := referenceContext(t, auth.ActorTypeUser, node.UserID())
	svc := referenceService(t, referenceDB{primary: stack.DB().Primary()})

	check := func(t *testing.T, ctx context.Context, bearer string, included bool) {
		t.Helper()
		actual, err := svc.ListProjects(ctx)
		require.NoError(t, err)
		var expected reference.Projects
		response, err := node.Client().R().SetAuthToken(bearer).SetResult(&expected).Get("/api/v1/vaultix/projects")
		require.NoError(t, err)
		require.Equal(t, 200, response.StatusCode())
		require.Equal(t, &expected, actual)
		matches := 0
		for _, item := range actual.Projects {
			if item.ID == project.ID {
				matches++
			}
		}
		if included {
			require.Equal(t, 1, matches, "direct and group membership must not duplicate the project")
		} else {
			require.Zero(t, matches)
		}
	}
	t.Run("no-membership", func(t *testing.T) { check(t, identityCtx, token, false) })
	node.AddIdentityToProject(t, project.ID, identity.ID, infra.Role("no-access"))
	t.Run("direct-no-access-membership-visible", func(t *testing.T) { check(t, identityCtx, token, true) })
	t.Run("user-direct", func(t *testing.T) { check(t, userCtx, node.UserToken(), true) })

	group := node.CreateGroup(t, "discovery-"+uuid.NewString()[:8])
	t.Cleanup(func() {
		response, err := node.Client().R().SetAuthToken(node.UserToken()).Delete("/api/v1/groups/" + group.ID)
		require.NoError(t, err)
		require.Less(t, response.StatusCode(), 300)
	})
	node.AddUserToGroup(t, group.ID, node.UserEmail())
	response, err := node.Client().R().SetAuthToken(node.UserToken()).SetBody(struct{}{}).
		Post("/api/v1/groups/" + group.ID + "/machine-identities/" + identity.ID)
	require.NoError(t, err)
	require.Equal(t, 200, response.StatusCode())
	node.AddGroupToProject(t, project.ID, group.ID, "viewer")
	t.Run("user-direct-and-group", func(t *testing.T) { check(t, userCtx, node.UserToken(), true) })
	t.Run("identity-direct-and-group", func(t *testing.T) { check(t, identityCtx, token, true) })

	// Disposable fixture mutations exercise the existing store without claiming
	// that a new membership/deletion API has been implemented.
	_, err = stack.DB().Primary().Exec(t.Context(), `DELETE FROM memberships WHERE "scopeProjectId"=$1 AND ("actorUserId"=$2 OR "actorIdentityId"=$3)`, project.ID, node.UserID(), identity.ID)
	require.NoError(t, err)
	t.Run("user-group-only", func(t *testing.T) { check(t, userCtx, node.UserToken(), true) })
	t.Run("identity-group-only", func(t *testing.T) { check(t, identityCtx, token, true) })

	t.Run("deleted-environments", func(t *testing.T) {
		_, err := stack.DB().Primary().Exec(t.Context(), `UPDATE project_environments SET "deleteAfter"=NOW()+interval '1 day' WHERE "projectId"=$1`, project.ID)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := stack.DB().Primary().Exec(context.Background(), `UPDATE project_environments SET "deleteAfter"=NULL WHERE "projectId"=$1`, project.ID)
			require.NoError(t, err)
		})
		check(t, identityCtx, token, true)
		page, err := svc.ListProjects(identityCtx)
		require.NoError(t, err)
		require.Len(t, page.Projects, 1)
		require.NotNil(t, page.Projects[0].Environments)
		require.Empty(t, page.Projects[0].Environments)
	})
	t.Run("deleted-project", func(t *testing.T) {
		_, err := stack.DB().Primary().Exec(t.Context(), `UPDATE projects SET "deleteAfter"=NOW()+interval '1 day' WHERE id=$1`, project.ID)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := stack.DB().Primary().Exec(context.Background(), `UPDATE projects SET "deleteAfter"=NULL WHERE id=$1`, project.ID)
			require.NoError(t, err)
		})
		check(t, identityCtx, token, false)
	})
	t.Run("other-product", func(t *testing.T) {
		_, err := stack.DB().Primary().Exec(t.Context(), `UPDATE projects SET type='certificate-manager' WHERE id=$1`, project.ID)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := stack.DB().Primary().Exec(context.Background(), `UPDATE projects SET type='secret-manager' WHERE id=$1`, project.ID)
			require.NoError(t, err)
		})
		check(t, identityCtx, token, false)
	})
	t.Run("cross-tenant-service-context", func(t *testing.T) {
		ctx := auth.WithIdentity(t.Context(), &auth.Identity{Actor: auth.ActorTypeIdentity, ActorID: uuid.MustParse(identity.ID), OrgID: uuid.New(), AuthMode: auth.AuthModeIdentityAccessToken})
		page, err := svc.ListProjects(ctx)
		require.NoError(t, err)
		require.NotNil(t, page.Projects)
		require.Empty(t, page.Projects)
	})
	t.Run("canceled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(identityCtx)
		cancel()
		page, err := svc.ListProjects(ctx)
		require.Error(t, err)
		require.Nil(t, page)
	})
	_, err = stack.DB().Primary().Exec(t.Context(), `DELETE FROM identity_group_membership WHERE "groupId"=$1 AND "identityId"=$2`, group.ID, identity.ID)
	require.NoError(t, err)
	t.Run("group-membership-revoked", func(t *testing.T) { check(t, identityCtx, token, false) })
}
