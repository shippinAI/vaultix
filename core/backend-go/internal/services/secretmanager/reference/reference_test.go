package reference

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/vaultix/gocasl"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
)

type noReadDB struct{}

func (noReadDB) Primary() *pgxpool.Pool { panic("unexpected metadata lookup") }
func (noReadDB) Replica() *pgxpool.Pool { panic("unexpected replica lookup") }
func (noReadDB) ReplicaCount() int      { return 0 }
func (noReadDB) Close()                 {}

type permissionStub struct {
	result *permission.GetProjectPermissionResult
	err    error
	calls  int
}

func (p *permissionStub) GetProjectPermission(context.Context, *permission.GetProjectPermissionArgs) (*permission.GetProjectPermissionResult, error) {
	p.calls++
	return p.result, p.err
}

func validQuery() Query {
	return Query{ProjectID: uuid.NewString(), Environment: "dev", SecretPath: "/", Limit: 50}
}

func trustedContext() context.Context {
	return auth.WithIdentity(context.Background(), &auth.Identity{Actor: auth.ActorTypeUser, ActorID: uuid.New(), OrgID: uuid.New(), AuthMode: auth.AuthModeJWT})
}

func TestQuery_BoundsAndFolderCompatibility(t *testing.T) {
	for _, path := range []string{"/", "//", "/api/", "//api///nested/", "/a-b_c/"} {
		t.Run(path, func(t *testing.T) {
			q := validQuery()
			q.SecretPath = path
			_, err := q.segments()
			require.NoError(t, err)
		})
	}
	for _, mutate := range []struct {
		name  string
		apply func(*Query)
	}{
		{"project", func(q *Query) { q.ProjectID = "other" }},
		{"environment", func(q *Query) { q.Environment = "../dev" }},
		{"relative", func(q *Query) { q.SecretPath = "api" }},
		{"traversal", func(q *Query) { q.SecretPath = "/a/../b" }},
		{"backslash", func(q *Query) { q.SecretPath = "/a\\b" }},
		{"control", func(q *Query) { q.SecretPath = "/a\x00b" }},
		{"unicode", func(q *Query) { q.SecretPath = "/秘密" }},
		{"zero-limit", func(q *Query) { q.Limit = 0 }},
		{"large-limit", func(q *Query) { q.Limit = 101 }},
		{"negative-offset", func(q *Query) { q.Offset = -1 }},
		{"large-offset", func(q *Query) { q.Offset = 1000001 }},
	} {
		t.Run(mutate.name, func(t *testing.T) { q := validQuery(); mutate.apply(&q); _, err := q.segments(); require.Error(t, err) })
	}
}

func TestList_RefusesBeforeMetadataLookup(t *testing.T) {
	denied := errors.New("authority unavailable")
	emptyAbility, err := gocasl.LoadFromJSON([]byte(`[]`), gocasl.LoadOptions{})
	require.NoError(t, err)
	for _, scenario := range []struct {
		name       string
		ctx        context.Context
		permission *permissionStub
		status     int
	}{
		{"anonymous", context.Background(), &permissionStub{}, 401},
		{"service-token", auth.WithIdentity(context.Background(), &auth.Identity{Actor: auth.ActorTypeService, ActorID: uuid.New(), OrgID: uuid.New(), AuthMode: auth.AuthModeServiceToken}), &permissionStub{}, 401},
		{"missing-org", auth.WithIdentity(context.Background(), &auth.Identity{Actor: auth.ActorTypeUser, ActorID: uuid.New(), AuthMode: auth.AuthModeJWT}), &permissionStub{}, 401},
		{"authority-error", trustedContext(), &permissionStub{err: denied}, 0},
		{"missing-ability", trustedContext(), &permissionStub{}, 500},
		{"no-grant", trustedContext(), &permissionStub{result: &permission.GetProjectPermissionResult{Permission: permission.ProjectPermission{Ability: emptyAbility}}}, 403},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{DB: noReadDB{}, Permission: scenario.permission})
			page, err := svc.List(scenario.ctx, validQuery())
			require.Nil(t, page)
			if scenario.status == 0 {
				require.ErrorIs(t, err, denied)
				return
			}
			var appError *errutil.Error
			require.ErrorAs(t, err, &appError)
			require.Equal(t, scenario.status, appError.Status)
			if scenario.status == 401 {
				require.Zero(t, scenario.permission.calls)
			}
		})
	}
}

func TestPage_EmptyReferencesRemainAnArray(t *testing.T) {
	encoded, err := json.Marshal(Page{References: []Reference{}})
	require.NoError(t, err)
	require.Contains(t, string(encoded), `"references":[]`)
	require.Contains(t, string(encoded), `"nextOffset":null`)
}

func TestListProjects_RefusesUnauthenticatedMetadataLookup(t *testing.T) {
	svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{DB: noReadDB{}, Permission: nil})
	for _, ctx := range []context.Context{
		context.Background(),
		auth.WithIdentity(context.Background(), &auth.Identity{Actor: auth.ActorTypeService, ActorID: uuid.New(), OrgID: uuid.New(), AuthMode: auth.AuthModeServiceToken}),
		auth.WithIdentity(context.Background(), &auth.Identity{Actor: auth.ActorTypeUser, ActorID: uuid.New(), AuthMode: auth.AuthModeJWT}),
	} {
		page, err := svc.ListProjects(ctx)
		require.Error(t, err)
		require.Nil(t, page)
	}
}
