package api

import (
	"log/slog"

	"github.com/go-chi/chi/v5"

	"github.com/vaultix-cloud/api/internal/server/api/platform/projects"
	"github.com/vaultix-cloud/api/internal/server/api/platform/usersessions"
	"github.com/vaultix-cloud/api/internal/server/api/shared"
	"github.com/vaultix-cloud/api/internal/services/auth/apiauth"
	"github.com/vaultix-cloud/api/internal/services/ratelimit"
)

// RegisterPlatformRoutes initializes platform handlers and registers their routes.
func RegisterPlatformRoutes(router chi.Router, logger *slog.Logger, svc *PlatformServices) {
	l := logger.With(slog.String("product", "platform"))
	if svc.DeviceAuthorization != nil {
		svc.DeviceAuthorization.Register(router)
	}

	usersessions.NewHandler(svc.UserSessions, shared.NewErrorHandler(l)).Register(router, svc.ApiAuthenticator.RequireAuth(
		apiauth.WithAuthModes(apiauth.JWTAuth),
		apiauth.WithAssumePrivilege(false),
	))

	projectsHandler := projects.NewHandler(&projects.Deps{
		Logger:     l,
		Permission: svc.Permission,
	})

	// Create adapter with shared error handler
	projectsAdapter := projects.NewHTTPAdapter(projectsHandler, shared.NewErrorHandler(l))

	// Mount projects routes
	router.Route("/api/v1/platform/projects", func(r chi.Router) {
		// Unauthenticated routes
		r.Get("/health", projectsAdapter.GetProjectsHealth)

		// Authenticated routes
		r.Group(func(r chi.Router) {
			r.Use(svc.ApiAuthenticator.RequireAuth(
				apiauth.WithAuthModes(apiauth.JWTAuth, apiauth.IdentityAccessTokenAuth, apiauth.ServiceTokenAuth),
			))
			r.Use(svc.RateLimit.Middleware(ratelimit.PresetWrite))
			r.Post("/", projectsAdapter.CreateProject)
		})
	})
}
