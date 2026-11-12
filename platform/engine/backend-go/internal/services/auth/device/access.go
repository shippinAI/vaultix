package device

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5"

	"github.com/vaultix-cloud/api/internal/database/pg"
	"github.com/vaultix-cloud/api/internal/services/auth"
)

type AccessVerifierDeps struct {
	DB          pg.DB
	Credentials *Credentials
	Authority   *NativeAuthority
}

// Resource servers receive no issuance/renewal interface or refresh policy.
func NewAccessVerifier(_ context.Context, logger *slog.Logger, deps *AccessVerifierDeps) (*AccessVerifier, error) {
	if logger == nil || deps == nil || deps.DB == nil || !deps.Credentials.valid() || deps.Authority == nil {
		return nil, ErrUnavailable
	}
	return &AccessVerifier{db: deps.DB, credentials: deps.Credentials, authority: deps.Authority, logger: logger}, nil
}

func (s *AccessVerifier) AuthenticateAccess(ctx context.Context, token string) (*auth.Identity, error) {
	var actor *auth.Identity
	_, err := s.withAccess(ctx, token, func(ctx context.Context, tx pgx.Tx, identity AccessIdentity) error {
		resolved := &auth.Identity{
			AuthMode: auth.AuthModeDeviceAccess, Actor: auth.ActorTypeUser, ActorID: identity.UserID,
			OrgID: identity.OrgID, RootOrgID: identity.RootOrgID, TokenVersionID: identity.SessionID,
			SessionAccessVersion: new(identity.AccessVersion), AuthMethod: auth.ActorAuthMethod(identity.AuthMethod),
			IsMfaVerified: identity.MFAVerified, MfaMethod: identity.MFAMethod,
		}
		// The account/session locks and authority check remain held on this same
		// connection. Display/profile fields never come from an unsigned locator.
		err := tx.QueryRow(ctx, `SELECT COALESCE(u.email,''),COALESCE(u.username,''),COALESCE(u."superAdmin",false),
 o.name,COALESCE(o."parentOrgId",o.id) FROM vx_auth_users u CROSS JOIN vx_workspace_organizations o
 WHERE u.id=@user AND o.id=@org AND COALESCE(o."rootOrgId",o.id)=@root`,
			pgx.NamedArgs{"user": identity.UserID, "org": identity.OrgID, "root": identity.RootOrgID}).Scan(
			&resolved.Email, &resolved.Username, &resolved.IsSuperAdmin, &resolved.OrgName, &resolved.ParentOrgID)
		if err != nil {
			return s.failure(ctx, "actor", err)
		}
		resolved.UserAuthInfo = &auth.UserAuthInfo{UserID: identity.UserID, Email: resolved.Email}
		actor = resolved
		return nil
	})
	if err != nil {
		return nil, err
	}
	return actor, nil
}
