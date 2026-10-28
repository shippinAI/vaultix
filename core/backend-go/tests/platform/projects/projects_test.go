//go:build integration

package projects_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/server/api/platform/projects"
	"github.com/vaultix/api/internal/server/api/shared"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
	"github.com/vaultix/api/tests/infra"
)

var stack *infra.Stack

func TestMain(m *testing.M) {
	stack = infra.New().
		WithPostgres().
		WithRedis().
		WithNodeJSApi().
		MustStart()

	code := m.Run()
	stack.Stop()
	os.Exit(code)
}

// newProjectsRouter creates a projects router for HTTP testing.
func newProjectsRouter(t *testing.T) http.Handler {
	t.Helper()

	ctx := t.Context()
	permLib := permission.NewService(ctx, infra.NopLogger(), &permission.Deps{DB: stack.DB()})

	handler := projects.NewHandler(&projects.Deps{
		Logger:     infra.NopLogger(),
		Permission: permLib,
	})

	return projects.NewRouter(handler, projects.WithErrorHandler(shared.NewErrorHandler(infra.NopLogger())))
}

func TestGetHealth_ReturnsOK(t *testing.T) {
	router := newProjectsRouter(t)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/health", http.NoBody)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)

	var resp projects.GetHealthResponse
	err := json.NewDecoder(rec.Body).Decode(&resp)
	require.NoError(t, err)
	assert.Equal(t, "projects service is healthy", resp.Message)
}

func TestCreateProject_DoesNotReportAnUnpersistedSuccess(t *testing.T) {
	router := newProjectsRouter(t)
	var before int
	require.NoError(t, stack.DB().Primary().QueryRow(t.Context(), `SELECT count(*) FROM projects`).Scan(&before))

	body := `{"name":"my-new-project","orgId":"` + stack.NodeJS().OrgID() + `"}`
	ctx := auth.WithIdentity(t.Context(), &auth.Identity{
		AuthMode: auth.AuthModeJWT, Actor: auth.ActorTypeUser,
		ActorID: uuid.MustParse(stack.NodeJS().UserID()), OrgID: uuid.MustParse(stack.NodeJS().OrgID()),
	})
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotImplemented, rec.Code)

	var resp shared.Error
	err := json.NewDecoder(rec.Body).Decode(&resp)
	require.NoError(t, err)
	assert.Contains(t, resp.ErrorData, "POST /api/v1/projects")
	assert.NotContains(t, rec.Body.String(), "generated-id")
	var after int
	require.NoError(t, stack.DB().Primary().QueryRow(t.Context(), `SELECT count(*) FROM projects`).Scan(&after))
	assert.Equal(t, before, after)
}

func TestCreateProject_ExistingWorkflowPersistsProject(t *testing.T) {
	created := stack.NodeJS().CreateProject(t, "preserved-project-create")
	var orgID string
	require.NoError(t, stack.DB().Primary().QueryRow(t.Context(), `SELECT "orgId" FROM projects WHERE id = $1`, created.ID).Scan(&orgID))
	assert.Equal(t, stack.NodeJS().OrgID(), orgID)
}

func TestCreateProject_RequiresIdentity(t *testing.T) {
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(`{"name":"anonymous","orgId":"unknown"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	newProjectsRouter(t).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}
