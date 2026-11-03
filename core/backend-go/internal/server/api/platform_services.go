package api

import (
	"context"
	"fmt"
	"time"

	"github.com/vaultix/api/internal/ee/services/externalkms"
	"github.com/vaultix/api/internal/ee/services/license"
	"github.com/vaultix/api/internal/ee/services/ratelimit"
	"github.com/vaultix/api/internal/server/api/platform/deviceauth"
	"github.com/vaultix/api/internal/server/api/shared"
	"github.com/vaultix/api/internal/services/assumeprivilege"
	"github.com/vaultix/api/internal/services/auditlog"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/internal/services/auth/device"
	"github.com/vaultix/api/internal/services/kms"
	"github.com/vaultix/api/internal/services/permission"
	"github.com/vaultix/api/internal/services/project"
)

// PlatformServices holds platform-level services shared across handlers.
type PlatformServices struct {
	ApiAuthenticator    *apiauth.ApiAuthenticator
	DeviceAuthorization *deviceauth.Handler
	Permission          *permission.Service
	KMS                 *kms.Service
	License             *license.Service
	Project             *project.Service
	AuditLog            *auditlog.Service
	AssumePrivilege     *assumeprivilege.Service
	RateLimit           *ratelimit.Service
}

func newPlatformServices(ctx context.Context, infra *Infra) (*PlatformServices, error) {
	externalKmsSvc, err := externalkms.NewService(ctx, infra.Logger, &externalkms.Deps{})
	if err != nil {
		return nil, fmt.Errorf("external kms: %w", err)
	}

	kmsSvc, err := kms.NewService(ctx, infra.Logger, &kms.Deps{
		DB:          infra.DB,
		HSM:         infra.HSM,
		ExternalKms: externalKmsSvc,
		Config:      infra.Config,
	})
	if err != nil {
		return nil, fmt.Errorf("kms: %w", err)
	}

	err = kmsSvc.Start(ctx, infra.HSM != nil)
	if err != nil {
		return nil, fmt.Errorf("kms start: %w", err)
	}

	permissionSvc := permission.NewService(ctx, infra.Logger, &permission.Deps{DB: infra.DB})

	projectSvc := project.NewService(ctx, infra.Logger, &project.Deps{DB: infra.DB})

	assumePrivilegeSvc := assumeprivilege.NewService(ctx, infra.Logger, &assumeprivilege.Deps{
		AuthSecret:        infra.Config.AuthSecret,
		PermissionService: permissionSvc,
	})

	var deviceAccess apiauth.DeviceAccessVerifier
	var deviceGrants *device.Service
	var deviceSessions *device.Sessions
	if infra.Config.DeviceAuthorizationEnabled && !infra.Config.DeviceAccessPolicy.Enabled {
		return nil, fmt.Errorf("device authorization requires device access validation")
	}
	if infra.Config.DeviceAccessPolicy.Enabled {
		credentials, err := device.NewCredentials(ctx, infra.Logger, &device.CredentialsDeps{
			Secret: []byte(infra.Config.AuthSecret), Resource: infra.Config.SiteURL,
			AccessLifetime: infra.Config.DeviceAccessPolicy.Lifetime,
		})
		if err != nil {
			return nil, fmt.Errorf("device access configuration is invalid")
		}
		authority, err := device.NewNativeAuthority(ctx, infra.Logger, &device.NativeAuthorityDeps{})
		if err != nil {
			return nil, fmt.Errorf("device access authority is unavailable")
		}
		deviceAccess, err = device.NewAccessVerifier(ctx, infra.Logger, &device.AccessVerifierDeps{
			DB: infra.DB, Credentials: credentials, Authority: authority,
		})
		if err != nil {
			return nil, fmt.Errorf("device access verifier is unavailable")
		}
		if infra.Config.DeviceAuthorizationEnabled {
			deviceSessions, err = device.NewSessions(ctx, infra.Logger, &device.SessionsDeps{
				DB: infra.DB, Credentials: credentials, Authority: authority, RefreshLifetime: 30 * 24 * time.Hour,
			})
			if err != nil {
				return nil, fmt.Errorf("device session owner is unavailable")
			}
			deviceGrants, err = device.NewService(ctx, infra.Logger, &device.Deps{
				DB: infra.DB, HashKey: []byte(infra.Config.AuthSecret), Resource: infra.Config.SiteURL,
				MaxOutstanding: 10000, Authority: authority, SessionIssuer: deviceSessions,
			})
			if err != nil {
				return nil, fmt.Errorf("device authorization owner is unavailable")
			}
		}
	}

	apiAuthenticator, err := apiauth.NewApiAuthenticator(ctx, infra.Logger, &apiauth.AuthenticatorDeps{
		DB: infra.DB, AuthSecret: infra.Config.AuthSecret, KeyStore: infra.KeyStore,
		AssumePrivilege: assumePrivilegeSvc, ErrorHandler: shared.NewErrorHandler(infra.Logger), IdentityPolicy: infra.Config.IdentityTokenPolicy,
		DeviceAccess: deviceAccess,
	})
	if err != nil {
		return nil, fmt.Errorf("authentication: %w", err)
	}
	var deviceHandler *deviceauth.Handler
	if infra.Config.DeviceAuthorizationEnabled {
		if infra.Redis == nil {
			return nil, fmt.Errorf("device authorization requires shared request limiting")
		}
		deviceHandler, err = deviceauth.NewHandler(&deviceauth.Deps{
			Grants: deviceGrants, Sessions: deviceSessions, Resource: infra.Config.SiteURL,
			Limiter:     &deviceauth.RedisLimiter{Client: infra.Redis, Resource: infra.Config.SiteURL},
			BrowserAuth: apiAuthenticator.RequireAuth(apiauth.WithAuthModes(apiauth.JWTAuth)),
		})
		if err != nil {
			return nil, fmt.Errorf("device authorization HTTP configuration is invalid")
		}
	}

	auditLogSvc := auditlog.NewService(ctx, infra.Logger, &auditlog.Deps{
		Queue:  infra.Queue,
		Config: infra.Config,
	})

	auditLogQueueHandler := auditlog.NewQueueHandler(ctx, infra.Logger, &auditlog.QueueHandlerDeps{
		Project:  projectSvc,
		License:  infra.License,
		KeyStore: infra.KeyStore,
	})
	auditLogQueueHandler.Register(infra.Queue)

	rateLimitSvc := ratelimit.NewService(ctx, infra.Logger, &ratelimit.Deps{
		Redis:      infra.Redis,
		LicenseSvc: infra.License,
		IsCloud:    infra.Config.IsCloud,
		IsEnabled:  infra.Config.IsCloud && infra.Config.IsProductionMode,
	})

	svc := &PlatformServices{
		ApiAuthenticator:    apiAuthenticator,
		DeviceAuthorization: deviceHandler,
		Permission:          permissionSvc,
		KMS:                 kmsSvc,
		License:             infra.License,
		Project:             projectSvc,
		AuditLog:            auditLogSvc,
		AssumePrivilege:     assumePrivilegeSvc,
		RateLimit:           rateLimitSvc,
	}

	return svc, nil
}
