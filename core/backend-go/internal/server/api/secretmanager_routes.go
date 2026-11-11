package api

import (
	"log/slog"

	"github.com/go-chi/chi/v5"

	"github.com/vaultix-cloud/api/internal/server/api/secretmanager/secret"
	"github.com/vaultix-cloud/api/internal/server/api/shared"
	"github.com/vaultix-cloud/api/internal/server/api/vaultixref"
	"github.com/vaultix-cloud/api/internal/services/auth/apiauth"
	"github.com/vaultix-cloud/api/internal/services/ratelimit"
)

// RegisterSecretManagerRoutes initializes secret manager handlers and registers their routes.
func RegisterSecretManagerRoutes(router chi.Router, logger *slog.Logger, platform *PlatformServices, svc *SecretManagerServices) {
	l := logger.With(slog.String("product", "secretmanager"))

	secretsHandler := secret.NewHandler(&secret.Deps{
		Logger:     l,
		Permission: platform.Permission,
		Project:    platform.Project,
		AuditLog:   platform.AuditLog,
		Secrets:    svc.Secret,
	})

	// Create adapter with shared error handler
	secretsAdapter := secret.NewHTTPAdapter(secretsHandler, shared.NewErrorHandler(l))

	// Secrets routes - all require authentication
	router.Group(func(r chi.Router) {
		r.Use(platform.ApiAuthenticator.RequireAuth(
			apiauth.WithAuthModes(apiauth.JWTAuth, apiauth.IdentityAccessTokenAuth, apiauth.ServiceTokenAuth, apiauth.DeviceAccessAuth),
		))
		r.Use(platform.RateLimit.Middleware(ratelimit.PresetSecrets))

		// V4 endpoints
		r.Get("/api/v4/secrets", secretsAdapter.ListSecretsV4)
		r.Get("/api/v4/secrets/{secretName}", secretsAdapter.GetSecretByNameV4)

		// V3 endpoints (deprecated)
		r.Get("/api/v3/secrets/raw", secretsAdapter.ListSecretsRawV3)
		r.Get("/api/v3/secrets/raw/{secretName}", secretsAdapter.GetSecretByNameRawV3)
	})

	// Reference reads use the public Vaultix error and the self-hosted route
	// budgets. They do not use the cloud-only secret limiter.
	vaultixref.NewHandler(l, svc.Reference, platform.AuditLog, vaultixref.NewLimiter(nil)).Register(router,
		platform.ApiAuthenticator.RequireAuth(
			apiauth.WithAuthModes(apiauth.JWTAuth, apiauth.IdentityAccessTokenAuth),
			apiauth.WithPublicUnauthorized(),
		),
	)
}
