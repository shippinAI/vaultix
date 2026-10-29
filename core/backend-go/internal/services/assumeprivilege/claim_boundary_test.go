package assumeprivilege

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
)

func TestVerifyAssumePrivilegeToken_ClaimBoundary(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	for _, name := range []string{"valid", "missing-expiry", "missing-issued-at", "future-issued-at", "excessive-lifetime", "nonpositive-lifetime", "unknown-actor", "service-actor", "empty-project", "blank-project", "zero-requester", "zero-target", "zero-session"} {
		t.Run(name, func(t *testing.T) {
			session, requester, actor := uuid.New(), uuid.New(), uuid.New()
			claims := assumePrivilegeClaims{
				RegisteredClaims: jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour))},
				TokenVersionID:   session.String(), RequesterID: requester.String(), ActorID: actor.String(),
				ActorType: string(auth.ActorTypeUser), ProjectID: "project-fixture",
			}
			switch name {
			case "missing-expiry":
				claims.ExpiresAt = nil
			case "missing-issued-at":
				claims.IssuedAt = nil
			case "future-issued-at":
				claims.IssuedAt = jwt.NewNumericDate(now.Add(time.Minute))
			case "excessive-lifetime":
				claims.ExpiresAt = jwt.NewNumericDate(now.Add(2 * time.Hour))
			case "nonpositive-lifetime":
				claims.IssuedAt = jwt.NewNumericDate(now.Add(2 * time.Hour))
			case "unknown-actor":
				claims.ActorType = "unknown"
			case "service-actor":
				claims.ActorType = string(auth.ActorTypeService)
			case "empty-project":
				claims.ProjectID = ""
			case "blank-project":
				claims.ProjectID = "  "
			case "zero-requester":
				claims.RequesterID = uuid.Nil.String()
			case "zero-target":
				claims.ActorID = uuid.Nil.String()
			case "zero-session":
				session = uuid.Nil
				claims.TokenVersionID = session.String()
			}
			perms := &mockPermissionService{getProjectPermissionResult: &permission.GetProjectPermissionResult{Permission: permission.ProjectPermission{Ability: buildTestAbility(t, true, true)}}}
			svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{AuthSecret: "fixture-only-assumed-authority", PermissionService: perms})
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("fixture-only-assumed-authority"))
			require.NoError(t, err)
			result, err := svc.VerifyAssumePrivilegeToken(context.Background(), &VerifyTokenOpts{RequesterID: requester, Token: token, TokenVersionID: session, OrgID: uuid.New(), AuthMethod: "email"})
			if name == "valid" {
				require.NoError(t, err)
				require.NotNil(t, result)
				require.Equal(t, 1, perms.callCount)
			} else {
				require.Error(t, err)
				require.Nil(t, result)
				require.Zero(t, perms.callCount)
				require.NotContains(t, err.Error(), token)
			}
		})
	}
}

func TestAssumeProjectPrivileges_InvalidScope(t *testing.T) {
	for _, name := range []string{"nil", "actor-type", "target", "requester", "organization", "session", "project", "auth-method"} {
		t.Run(name, func(t *testing.T) {
			opts := &AssumeProjectPrivilegesOpts{TargetActorType: auth.ActorTypeUser, TargetActorID: uuid.New(), RequesterID: uuid.New(), RequesterOrgID: uuid.New(), TokenVersionID: uuid.New(), ProjectID: "project", AuthMethod: "email"}
			switch name {
			case "nil":
				opts = nil
			case "actor-type":
				opts.TargetActorType = auth.ActorTypeService
			case "target":
				opts.TargetActorID = uuid.Nil
			case "requester":
				opts.RequesterID = uuid.Nil
			case "organization":
				opts.RequesterOrgID = uuid.Nil
			case "session":
				opts.TokenVersionID = uuid.Nil
			case "project":
				opts.ProjectID = " "
			case "auth-method":
				opts.AuthMethod = ""
			}
			permissions := &mockPermissionService{}
			svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{AuthSecret: "fixture-only", PermissionService: permissions})
			result, err := svc.AssumeProjectPrivileges(context.Background(), opts)
			require.Error(t, err)
			require.Nil(t, result)
			require.Zero(t, permissions.callCount)
		})
	}
}

func TestVerifyAssumePrivilegeToken_SessionBinding(t *testing.T) {
	for _, name := range []string{"valid", "other-requester", "other-session", "no-requester", "no-session", "no-organization", "no-method", "nil"} {
		t.Run(name, func(t *testing.T) {
			permissions := &mockPermissionService{getProjectPermissionResult: &permission.GetProjectPermissionResult{Permission: permission.ProjectPermission{Ability: buildTestAbility(t, true, true)}}}
			svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{AuthSecret: "fixture-only", PermissionService: permissions})
			scope := &AssumeProjectPrivilegesOpts{TargetActorType: auth.ActorTypeIdentity, TargetActorID: uuid.New(), RequesterID: uuid.New(), RequesterOrgID: uuid.New(), TokenVersionID: uuid.New(), ProjectID: "project", AuthMethod: "email"}
			grant, err := svc.AssumeProjectPrivileges(context.Background(), scope)
			require.NoError(t, err)
			permissions.callCount = 0
			opts := &VerifyTokenOpts{Token: grant.AssumePrivilegesToken, RequesterID: scope.RequesterID, TokenVersionID: scope.TokenVersionID, OrgID: scope.RequesterOrgID, AuthMethod: scope.AuthMethod}
			switch name {
			case "other-requester":
				opts.RequesterID = uuid.New()
			case "other-session":
				opts.TokenVersionID = uuid.New()
			case "no-requester":
				opts.RequesterID = uuid.Nil
			case "no-session":
				opts.TokenVersionID = uuid.Nil
			case "no-organization":
				opts.OrgID = uuid.Nil
			case "no-method":
				opts.AuthMethod = ""
			case "nil":
				opts = nil
			}
			result, err := svc.VerifyAssumePrivilegeToken(context.Background(), opts)
			if name == "valid" {
				require.NoError(t, err)
				require.NotNil(t, result)
				require.Equal(t, 1, permissions.callCount)
			} else {
				require.Error(t, err)
				require.Nil(t, result)
				require.Zero(t, permissions.callCount)
			}
		})
	}
}

type grantPermissionFailure struct {
	result        *permission.GetProjectPermissionResult
	calls, failAt int
	failure       error
}

func (p *grantPermissionFailure) GetProjectPermission(_ context.Context, _ *permission.GetProjectPermissionArgs) (*permission.GetProjectPermissionResult, error) {
	p.calls++
	if p.calls == p.failAt {
		return nil, p.failure
	}
	return p.result, nil
}

func TestAssumeProjectPrivileges_AuthorityFailure(t *testing.T) {
	for _, name := range []string{"requester-database", "target-database", "target-membership", "target-canceled"} {
		t.Run(name, func(t *testing.T) {
			perms := &grantPermissionFailure{result: &permission.GetProjectPermissionResult{Permission: permission.ProjectPermission{Ability: buildTestAbility(t, true, true)}}, failAt: 2, failure: errutil.DatabaseErr("Authority unavailable")}
			status := 500
			if name == "requester-database" {
				perms.failAt = 1
			}
			if name == "target-membership" {
				perms.failure = errutil.Forbidden("No membership")
				status = 400
			}
			if name == "target-canceled" {
				perms.failure = context.Canceled
			}
			svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{AuthSecret: "fixture-only", PermissionService: perms})
			result, err := svc.AssumeProjectPrivileges(context.Background(), &AssumeProjectPrivilegesOpts{TargetActorType: auth.ActorTypeIdentity, TargetActorID: uuid.New(), RequesterID: uuid.New(), RequesterOrgID: uuid.New(), TokenVersionID: uuid.New(), ProjectID: "project", AuthMethod: "email"})
			require.Error(t, err)
			require.Nil(t, result)
			require.Equal(t, perms.failAt, perms.calls)
			if name == "target-canceled" {
				require.ErrorIs(t, err, context.Canceled)
			} else {
				var failure *errutil.Error
				require.ErrorAs(t, err, &failure)
				require.Equal(t, status, failure.Status)
			}
		})
	}
}
