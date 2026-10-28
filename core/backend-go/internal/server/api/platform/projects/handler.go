//go:generate go tool oapi-codegen -config cfg.yaml openapi.yml

package projects

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
)

// Compile-time check that Handler implements ServiceInterface.
var _ ServiceInterface = (*Handler)(nil)

// PermissionService provides project permission checks.
type PermissionService interface {
	GetProjectPermission(ctx context.Context, args *permission.GetProjectPermissionArgs) (*permission.GetProjectPermissionResult, error)
}

// Handler provides HTTP handlers for projects endpoints.
type Handler struct {
	logger     *slog.Logger
	permission PermissionService
}

// Deps holds the dependencies for the projects handler.
type Deps struct {
	Logger     *slog.Logger
	Permission PermissionService
}

// NewHandler creates a new projects handler.
func NewHandler(deps *Deps) *Handler {
	return &Handler{
		logger:     deps.Logger.With(slog.String("handler", "projects")),
		permission: deps.Permission,
	}
}

// GetProjectsHealth handles the health check endpoint.
func (h *Handler) GetProjectsHealth(ctx context.Context) (*GetProjectsHealthResponseData, error) {
	h.logger.InfoContext(ctx, "health check")
	return NewGetProjectsHealthResponseData(&GetHealthResponse{
		Message: "projects service is healthy",
	}), nil
}

func (h *Handler) CreateProject(ctx context.Context, _ *CreateProjectServiceRequestOptions) (*CreateProjectResponseData, error) {
	if _, err := auth.IdentityFromContext(ctx); err != nil {
		return nil, err
	}
	// The active project workflow owns key setup, policies and transactional writes.
	// A staged native route must not acknowledge a write it cannot perform.
	return nil, errutil.InternalServer("Native project creation is unavailable; use the existing project workflow.").
		WithStatus(http.StatusNotImplemented).
		WithName("Native project creation is unavailable; use POST /api/v1/projects.")
}
