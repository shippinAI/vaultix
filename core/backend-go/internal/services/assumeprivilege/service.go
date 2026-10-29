package assumeprivilege

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
	"github.com/vaultix/api/internal/services/permission/platform"
)

// Existing application-issued grants expire one hour after issuance.
const tokenExpiry = time.Hour

// assumePrivilegeClaims is the JWT payload for assume privilege tokens.
type assumePrivilegeClaims struct {
	jwt.RegisteredClaims
	TokenVersionID string `json:"tokenVersionId"`
	ActorType      string `json:"actorType"`
	ActorID        string `json:"actorId"`
	ProjectID      string `json:"projectId"`
	RequesterID    string `json:"requesterId"`
}

// PermissionService is the interface for permission checks.
type PermissionService interface {
	GetProjectPermission(ctx context.Context, args *permission.GetProjectPermissionArgs) (*permission.GetProjectPermissionResult, error)
}

// Deps holds the dependencies for the assume privilege service.
type Deps struct {
	AuthSecret        string
	PermissionService PermissionService
}

// Service provides assume privilege functionality.
type Service struct {
	logger            *slog.Logger
	authSecret        []byte
	permissionService PermissionService
}

// NewService creates a new assume privilege service.
func NewService(_ context.Context, logger *slog.Logger, deps *Deps) *Service {
	return &Service{
		logger:            logger.With(slog.String("service", "assumeprivilege")),
		authSecret:        []byte(deps.AuthSecret),
		permissionService: deps.PermissionService,
	}
}

// AssumeProjectPrivileges creates an assume privilege token after verifying the requester has permission.
func (s *Service) AssumeProjectPrivileges(ctx context.Context, opts *AssumeProjectPrivilegesOpts) (*AssumeProjectPrivilegesResult, error) {
	if opts == nil || !supportedTarget(opts.TargetActorType) || opts.TargetActorID == uuid.Nil ||
		opts.RequesterID == uuid.Nil || opts.RequesterOrgID == uuid.Nil || opts.TokenVersionID == uuid.Nil ||
		strings.TrimSpace(opts.ProjectID) == "" || opts.AuthMethod == "" {
		return nil, errutil.BadRequest("A valid requester session, project and member or machine identity are required")
	}

	permResult, err := s.permissionService.GetProjectPermission(ctx, &permission.GetProjectPermissionArgs{
		Actor:             auth.ActorTypeUser,
		ActorID:           opts.RequesterID,
		ProjectID:         opts.ProjectID,
		ActorAuthMethod:   opts.AuthMethod,
		ActorOrgID:        opts.RequesterOrgID,
		ActionProjectType: permission.ActionProjectTypeAny,
	})
	if err != nil {
		return nil, err
	}

	// Check permission based on target actor type
	checker := platform.NewAssumePrivilegeChecker(permResult.Permission.Ability)
	if opts.TargetActorType == auth.ActorTypeUser {
		if !checker.CanAssumeMemberPrivileges() {
			return nil, errutil.Forbidden("You do not have permission to assume member privileges")
		}
	} else {
		if !checker.CanAssumeIdentityPrivileges(opts.TargetActorID.String()) {
			return nil, errutil.Forbidden("You do not have permission to assume identity privileges")
		}
	}

	_, err = s.permissionService.GetProjectPermission(ctx, &permission.GetProjectPermissionArgs{
		Actor:             opts.TargetActorType,
		ActorID:           opts.TargetActorID,
		ProjectID:         opts.ProjectID,
		ActorAuthMethod:   opts.AuthMethod,
		ActorOrgID:        opts.RequesterOrgID,
		ActionProjectType: permission.ActionProjectTypeAny,
	})
	if err != nil {
		var failure *errutil.Error
		if errors.As(err, &failure) && (failure.Status == http.StatusForbidden || failure.Status == http.StatusNotFound) {
			return nil, errutil.BadRequest("Target actor is not a member of this project").WithErr(err)
		}
		// An unavailable authority store is not a target-membership mistake.
		return nil, err
	}

	now := time.Now()
	claims := assumePrivilegeClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
		TokenVersionID: opts.TokenVersionID.String(),
		ActorType:      string(opts.TargetActorType),
		ActorID:        opts.TargetActorID.String(),
		ProjectID:      opts.ProjectID,
		RequesterID:    opts.RequesterID.String(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedToken, err := token.SignedString(s.authSecret)
	if err != nil {
		return nil, errutil.InternalServer("Failed to create assume privilege token").WithErrf("AssumeProjectPrivileges: %w", err)
	}

	return &AssumeProjectPrivilegesResult{
		ActorType:             opts.TargetActorType,
		ActorID:               opts.TargetActorID,
		ProjectID:             opts.ProjectID,
		AssumePrivilegesToken: signedToken,
	}, nil
}

// VerifyAssumePrivilegeToken verifies an assume privilege token and returns the decoded details.
func (s *Service) VerifyAssumePrivilegeToken(ctx context.Context, opts *VerifyTokenOpts) (*auth.AssumedPrivilegeDetails, error) {
	if opts == nil || opts.RequesterID == uuid.Nil || opts.TokenVersionID == uuid.Nil || opts.OrgID == uuid.Nil || opts.AuthMethod == "" {
		return nil, errutil.Unauthorized("Sign in again before assuming privileges")
	}
	claims := &assumePrivilegeClaims{}
	_, err := jwt.ParseWithClaims(opts.Token, claims, func(_ *jwt.Token) (any, error) {
		return s.authSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		return nil, errutil.Unauthorized("Invalid assume privilege token")
	}
	if claims.IssuedAt == nil || claims.ExpiresAt == nil || !supportedTarget(auth.ActorType(claims.ActorType)) || strings.TrimSpace(claims.ProjectID) == "" {
		return nil, errutil.Unauthorized("Invalid assume privilege token")
	}
	lifetime := claims.ExpiresAt.Sub(claims.IssuedAt.Time)
	if lifetime <= 0 || lifetime > tokenExpiry {
		return nil, errutil.Unauthorized("Invalid assume privilege token")
	}
	requesterID, requesterErr := uuid.Parse(claims.RequesterID)
	actorID, actorErr := uuid.Parse(claims.ActorID)
	tokenVersionID, sessionErr := uuid.Parse(claims.TokenVersionID)
	if requesterErr != nil || actorErr != nil || sessionErr != nil || requesterID == uuid.Nil || actorID == uuid.Nil || tokenVersionID == uuid.Nil {
		return nil, errutil.Unauthorized("Invalid assume privilege token")
	}
	if tokenVersionID != opts.TokenVersionID {
		return nil, errutil.Forbidden("Invalid token version")
	}
	if requesterID != opts.RequesterID {
		return nil, errutil.Forbidden("Assumed privileges belong to another account")
	}

	permResult, err := s.permissionService.GetProjectPermission(ctx, &permission.GetProjectPermissionArgs{
		Actor:             auth.ActorTypeUser,
		ActorID:           requesterID,
		ProjectID:         claims.ProjectID,
		ActorAuthMethod:   opts.AuthMethod,
		ActorOrgID:        opts.OrgID,
		ActionProjectType: permission.ActionProjectTypeAny,
	})
	if err != nil {
		return nil, errutil.Forbidden("Requester no longer has project access").WithErrf("VerifyAssumePrivilegeToken: %w", err)
	}

	actorType := auth.ActorType(claims.ActorType)
	checker := platform.NewAssumePrivilegeChecker(permResult.Permission.Ability)
	if actorType == auth.ActorTypeUser {
		if !checker.CanAssumeMemberPrivileges() {
			return nil, errutil.Forbidden("Requester no longer has permission to assume member privileges")
		}
	} else {
		if !checker.CanAssumeIdentityPrivileges(actorID.String()) {
			return nil, errutil.Forbidden("Requester no longer has permission to assume identity privileges")
		}
	}

	return &auth.AssumedPrivilegeDetails{
		TokenVersionID: tokenVersionID,
		ProjectID:      claims.ProjectID,
		RequesterID:    requesterID,
		ActorType:      actorType,
		ActorID:        actorID,
	}, nil
}

func supportedTarget(actor auth.ActorType) bool {
	return actor == auth.ActorTypeUser || actor == auth.ActorTypeIdentity
}
