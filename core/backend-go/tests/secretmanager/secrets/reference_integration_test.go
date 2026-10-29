//go:build integration

package secrets_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
	"github.com/vaultix/api/internal/services/secretmanager/reference"
	"github.com/vaultix/api/tests/infra"
)

// Reference data uses a role that cannot SELECT value/ciphertext columns. The
// permission resolver independently uses the normal primary connection.
type referenceDB struct{ primary *pgxpool.Pool }

func (db referenceDB) Primary() *pgxpool.Pool { return db.primary }
func (db referenceDB) Replica() *pgxpool.Pool { panic("references must not read a stale replica") }
func (referenceDB) ReplicaCount() int         { return 1 }
func (referenceDB) Close()                    {}

func restrictedReferenceDB(t *testing.T) referenceDB {
	t.Helper()
	ctx := context.Background()
	role := "reference_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{role}.Sanitize()
	_, err := stack.DB().Primary().Exec(ctx, "CREATE ROLE "+quoted)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(ctx, "DROP OWNED BY "+quoted)
		require.NoError(t, err)
		_, err = stack.DB().Primary().Exec(ctx, "DROP ROLE "+quoted)
		require.NoError(t, err)
	})
	for _, grant := range []string{
		`SELECT (id, key, version, "createdAt", "updatedAt", "folderId", type, "userId") ON secrets_v2`,
		`SELECT ("secrets_v2Id", "secret_tagsId") ON secret_v2_tag_junction`,
		`SELECT (id, slug) ON secret_tags`,
		`SELECT (id, "envId", "parentId", name) ON secret_folders`,
		`SELECT (id, slug, "projectId", "deleteAfter") ON project_environments`,
	} {
		_, err := stack.DB().Primary().Exec(ctx, "GRANT "+grant+" TO "+quoted)
		require.NoError(t, err)
	}
	cfg := stack.DB().Primary().Config()
	cfg.ConnConfig.RuntimeParams["role"] = role
	cfg.MaxConns = 2
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, pool.Ping(ctx))
	_, err = pool.Exec(ctx, `SELECT * FROM secrets_v2 LIMIT 1`)
	require.Error(t, err, "fixture must deny broad/value-bearing secret queries")
	return referenceDB{primary: pool}
}

func referenceService(t *testing.T, db pg.DB) *reference.Service {
	t.Helper()
	perm := permission.NewService(t.Context(), infra.NopLogger(), &permission.Deps{DB: stack.DB()})
	return reference.NewService(t.Context(), infra.NopLogger(), &reference.Deps{DB: db, Permission: perm})
}

func referenceContext(t *testing.T, actor auth.ActorType, id string) context.Context {
	t.Helper()
	mode := auth.AuthModeJWT
	if actor == auth.ActorTypeIdentity {
		mode = auth.AuthModeIdentityAccessToken
	}
	// Trusted context is a service-test fixture, not a native HTTP authentication proof.
	return auth.WithIdentity(t.Context(), &auth.Identity{Actor: actor, ActorID: uuid.MustParse(id),
		OrgID: uuid.MustParse(stack.NodeJS().OrgID()), AuthMode: mode})
}

func existingReferences(t *testing.T, token string, q reference.Query) (page *reference.Page, status int) {
	t.Helper()
	var result reference.Page
	response, err := stack.NodeJS().Client().R().SetAuthToken(token).SetQueryParams(map[string]string{
		"projectId": q.ProjectID, "environment": q.Environment, "secretPath": q.SecretPath,
		"offset": strconv.Itoa(q.Offset), "limit": strconv.Itoa(q.Limit),
	}).SetResult(&result).Get("/api/v1/vaultix/secret-references")
	require.NoError(t, err)
	return &result, response.StatusCode()
}

func TestReference_MetadataOnlyDifferential(t *testing.T) {
	node := stack.NodeJS()
	project := node.CreateProject(t, "reference-"+uuid.NewString()[:8])
	t.Cleanup(func() { node.DeleteProject(t, project.ID) })
	publicTag := node.CreateTag(t, project.ID, "public", "Public", "#ff0000")
	for _, key := range []string{"A_HIDDEN", "Z_ALLOWED"} {
		opts := &infra.CreateSecretOpts{Comment: "CANARY_COMMENT", Metadata: []infra.SecretMetadataEntry{{Key: "CANARY_META", Value: "CANARY_METADATA"}}}
		if key == "Z_ALLOWED" {
			opts.TagIDs = []string{publicTag.ID}
		}
		node.CreateSecret(t, project.ID, project.EnvSlug, "/", key, "CANARY_SECRET_VALUE", opts)
	}
	node.CreateSecret(t, project.ID, project.EnvSlug, "/", "A_HIDDEN", "CANARY_PERSONAL", &infra.CreateSecretOpts{Type: "personal"})
	node.CreateFolder(t, project.ID, project.EnvSlug, "/", "nested")
	node.CreateFolder(t, project.ID, project.EnvSlug, "/", "empty")
	node.CreateSecret(t, project.ID, project.EnvSlug, "/nested", "NESTED", "CANARY_NESTED", nil)
	node.CreateSecretImport(t, project.ID, project.EnvSlug, "/", project.EnvSlug, "/nested")
	svc := referenceService(t, restrictedReferenceDB(t))
	ctx := referenceContext(t, auth.ActorTypeUser, node.UserID())
	for _, path := range []string{"/", "/nested", "//nested//", "/empty"} {
		for _, offset := range []int{0, 1, 2} {
			t.Run(fmt.Sprintf("%s-offset-%d", path, offset), func(t *testing.T) {
				q := reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: path, Offset: offset, Limit: 1}
				actual, err := svc.List(ctx, q)
				require.NoError(t, err)
				expected, status := existingReferences(t, node.UserToken(), q)
				require.Equal(t, 200, status)
				require.Equal(t, expected, actual)
				encoded, err := json.Marshal(actual)
				require.NoError(t, err)
				require.NotContains(t, string(encoded), "CANARY_")
			})
		}
	}
	t.Run("missing-folder", func(t *testing.T) {
		q := reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: "/missing", Limit: 50}
		page, err := svc.List(ctx, q)
		require.Error(t, err)
		require.Nil(t, page)
		_, status := existingReferences(t, node.UserToken(), q)
		require.Equal(t, 404, status)
	})
	t.Run("conditional-tags-and-filtered-page", func(t *testing.T) {
		identity := node.CreateIdentity(t, "reference-reader-"+uuid.NewString()[:8])
		t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
		role := node.CreateCustomProjectRole(t, project.ID, "reference-reader", "Reference Reader", []infra.Permission{
			{Subject: "secrets", Action: []string{"describeSecret"}, Conditions: map[string]any{"secretTags": map[string]any{"$in": []string{"public"}}}},
		})
		node.AddIdentityToProject(t, project.ID, identity.ID, infra.Role(role.Slug))
		token := node.GetIdentityAccessToken(t, identity.ID)
		identityCtx := referenceContext(t, auth.ActorTypeIdentity, identity.ID)
		for offset := 0; offset < 3; offset++ {
			q := reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: "/", Offset: offset, Limit: 1}
			actual, err := svc.List(identityCtx, q)
			require.NoError(t, err)
			expected, status := existingReferences(t, token, q)
			require.Equal(t, 200, status)
			require.Equal(t, expected, actual)
			if offset == 0 {
				require.Empty(t, actual.References)
				require.Equal(t, new(1), actual.NextOffset)
			}
			if offset == 1 {
				require.Len(t, actual.References, 1)
				require.Equal(t, "Z_ALLOWED", actual.References[0].Name)
			}
		}
		// Revoke the tag in the real primary; the reference reader must not reuse
		// stale metadata to authorize the formerly visible name.
		_, err := stack.DB().Primary().Exec(t.Context(), `DELETE FROM secret_v2_tag_junction WHERE "secret_tagsId" = $1`, publicTag.ID)
		require.NoError(t, err)
		page, err := svc.List(identityCtx, reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: "/", Limit: 50})
		require.NoError(t, err)
		require.Empty(t, page.References)
	})
	t.Run("wrong-tenant", func(t *testing.T) {
		ctx := auth.WithIdentity(t.Context(), &auth.Identity{Actor: auth.ActorTypeUser, ActorID: uuid.MustParse(node.UserID()), OrgID: uuid.New(), AuthMode: auth.AuthModeJWT})
		page, err := svc.List(ctx, reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: "/", Limit: 50})
		require.Error(t, err)
		require.Nil(t, page)
	})
	for _, scenario := range []struct {
		name, action string
		status       int
	}{
		{"describe", "describeSecret", 200},
		{"legacy-read", "read", 200},
		// The existing HTTP transport masks permission denials as unavailable.
		{"value-only-refuses", "readValue", 404},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			identity := node.CreateIdentity(t, "reference-role-"+uuid.NewString()[:8])
			t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
			role := node.CreateCustomProjectRole(t, project.ID, "reference-"+scenario.name, scenario.name, []infra.Permission{{Subject: "secrets", Action: []string{scenario.action}}})
			node.AddIdentityToProject(t, project.ID, identity.ID, infra.Role(role.Slug))
			token := node.GetIdentityAccessToken(t, identity.ID)
			query := reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: "/", Limit: 50}
			page, err := svc.List(referenceContext(t, auth.ActorTypeIdentity, identity.ID), query)
			expected, status := existingReferences(t, token, query)
			require.Equal(t, scenario.status, status)
			if status == 200 {
				require.NoError(t, err)
				require.Equal(t, expected, page)
			} else {
				var denied *errutil.Error
				require.ErrorAs(t, err, &denied)
				require.Equal(t, 403, denied.Status)
				require.Nil(t, page)
			}
		})
	}
	t.Run("metadata-primary-unavailable", func(t *testing.T) {
		db := restrictedReferenceDB(t)
		db.primary.Close()
		unavailable := referenceService(t, db)
		page, err := unavailable.List(ctx, reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: "/", Limit: 50})
		require.Error(t, err)
		require.Nil(t, page)
	})
	t.Run("canceled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(ctx)
		cancel()
		page, err := svc.List(ctx, reference.Query{ProjectID: project.ID, Environment: project.EnvSlug, SecretPath: "/", Limit: 50})
		require.Error(t, err)
		require.Nil(t, page)
	})
}
