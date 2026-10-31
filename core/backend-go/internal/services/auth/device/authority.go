package device

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
)

type NativeAuthorityDeps struct{}

type NativeAuthority struct {
	logger *slog.Logger
}

var _ Authority = (*NativeAuthority)(nil)

func NewNativeAuthority(_ context.Context, logger *slog.Logger, deps *NativeAuthorityDeps) (*NativeAuthority, error) {
	if logger == nil || deps == nil {
		return nil, ErrUnavailable
	}
	return &NativeAuthority{logger: logger}, nil
}

func (a *NativeAuthority) Approve(ctx context.Context, tx pgx.Tx, actor *auth.Identity) (Approval, error) {
	if actor == nil || actor.SessionAccessVersion == nil || auth.AssumedPrivilegeFromContext(ctx) != nil {
		return Approval{}, ErrDenied
	}
	approval := Approval{UserID: actor.ActorID, SessionID: actor.TokenVersionID, OrgID: actor.OrgID,
		RootOrgID: actor.RootOrgID, AccessVersion: *actor.SessionAccessVersion, AuthMethod: string(actor.AuthMethod),
		MFAVerified: actor.IsMfaVerified, MFAMethod: actor.MfaMethod, PolicyDigest: [32]byte{1}}
	if !matchesActor(&approval, actor) {
		return Approval{}, ErrDenied
	}
	digest, bypass, err := a.check(ctx, tx, &approval)
	if err != nil {
		return Approval{}, err
	}
	approval.PolicyDigest, approval.SSOBypass = digest, bypass
	return approval, nil
}

func (a *NativeAuthority) Revalidate(ctx context.Context, tx pgx.Tx, approval *Approval) error {
	if approval == nil || approval.PolicyDigest == [32]byte{} || auth.AssumedPrivilegeFromContext(ctx) != nil {
		return ErrDenied
	}
	digest, bypass, err := a.check(ctx, tx, approval)
	if err != nil {
		return err
	}
	if digest != approval.PolicyDigest || bypass != approval.SSOBypass {
		return ErrDenied
	}
	return nil
}

type deviceOrgPolicy struct {
	ID            uuid.UUID `json:"id"`
	RootID        uuid.UUID `json:"rootId"`
	AuthEnforced  bool      `json:"authEnforced"`
	Google        bool      `json:"google"`
	BypassEnabled bool      `json:"bypassEnabled"`
	MFA           bool      `json:"mfa"`
	MFAMethod     string    `json:"mfaMethod"`
}

type deviceMembership struct {
	ID     uuid.UUID `json:"id"`
	OrgID  uuid.UUID `json:"orgId"`
	Direct bool      `json:"direct"`
	Active bool      `json:"active"`
	Status *string   `json:"status"`
}

type deviceRole struct {
	permission.OrganizationSSORole
	OrgID  uuid.UUID `json:"orgId"`
	Active bool      `json:"active"`
}

type devicePolicy struct {
	UserMFA       bool               `json:"userMfa"`
	UserMFAMethod string             `json:"userMfaMethod"`
	EmailVerified bool               `json:"emailVerified"`
	Organizations []deviceOrgPolicy  `json:"organizations"`
	Memberships   []deviceMembership `json:"memberships"`
	Roles         []deviceRole       `json:"roles"`
	Factors       []json.RawMessage  `json:"factors"`
}

func (a *NativeAuthority) check(ctx context.Context, tx pgx.Tx, approval *Approval) (digest [32]byte, bypass bool, err error) {
	if tx == nil || approval.UserID == uuid.Nil || approval.SessionID == uuid.Nil || approval.OrgID == uuid.Nil ||
		approval.RootOrgID == uuid.Nil || approval.AccessVersion < 0 || !knownAuthMethod(approval.AuthMethod) {
		return [32]byte{}, false, ErrDenied
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	args := pgx.NamedArgs{"user": approval.UserID, "session": approval.SessionID, "version": approval.AccessVersion,
		"org": approval.OrgID, "root": approval.RootOrgID, "mfaMethod": approval.MFAMethod}
	// Account deletion cascades to sessions/grants. Preserve user-before-session
	// row order; the grant owner deliberately holds only an advisory lock here.
	var user uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=@user AND "isAccepted"=true
 AND "isGhost"=false AND "isLocked" IS NOT TRUE
 AND ("temporaryLockDateEnd" IS NULL OR "temporaryLockDateEnd"<=clock_timestamp()) FOR UPDATE`, args).Scan(&user)
	if err != nil {
		return [32]byte{}, false, a.failure(ctx, "account", err)
	}
	var session uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM auth_token_sessions
 WHERE id=@session AND "userId"=@user AND "accessVersion"=@version FOR UPDATE`, args).Scan(&session)
	if err != nil {
		return [32]byte{}, false, a.failure(ctx, "session", err)
	}
	// One statement observes policy consistently under READ COMMITTED. It does
	// not lock legacy membership/role writers or replace per-action authorization.
	var encoded []byte
	if err = tx.QueryRow(ctx, devicePolicyQuery, args).Scan(&encoded); err != nil {
		return [32]byte{}, false, a.failure(ctx, "policy", err)
	}
	var policy devicePolicy
	if err = json.Unmarshal(encoded, &policy); err != nil {
		return [32]byte{}, false, a.failure(ctx, "policy-decode", err)
	}
	bypass, err = policy.evaluate(approval)
	if err != nil {
		return [32]byte{}, false, err
	}
	return sha256.Sum256(append([]byte("vaultix.device-policy.v1\x00"), encoded...)), bypass, nil
}

func (a *NativeAuthority) failure(ctx context.Context, operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrDenied
	}
	a.logger.ErrorContext(ctx, "Vaultix device approval authority unavailable", slog.String("operation", operation))
	return ErrUnavailable
}

func knownAuthMethod(method string) bool {
	switch method {
	case "email", "google", "github", "gitlab", "ldap", "oidc", "azure-saml", "okta-saml", "jumpcloud-saml", "google-saml", "keycloak-saml":
		return true
	default:
		return false
	}
}

func (p *devicePolicy) evaluate(approval *Approval) (bool, error) {
	var root, selected *deviceOrgPolicy
	for i := range p.Organizations {
		org := &p.Organizations[i]
		if org.ID == approval.RootOrgID {
			root = org
		}
		if org.ID == approval.OrgID {
			selected = org
		}
	}
	if root == nil || selected == nil || root.RootID != root.ID || selected.RootID != root.ID ||
		!p.member(approval.OrgID, false) || (approval.OrgID != approval.RootOrgID && !p.member(approval.RootOrgID, true)) {
		return false, ErrDenied
	}
	// Organization selection owns login MFA at the root; a sub-organization's
	// separate resource policy must still be checked by the resource consumer.
	required, method := p.UserMFA, p.UserMFAMethod
	if root.MFA {
		required, method = true, root.MFAMethod
	}
	if method == "" {
		method = "email"
	}
	if required && (!approval.MFAVerified || approval.MFAMethod != method) {
		return false, ErrDenied
	}
	if approval.MFAVerified {
		switch approval.MFAMethod {
		case "email":
			if !p.EmailVerified {
				return false, ErrDenied
			}
		case "totp", "webauthn":
			if len(p.Factors) == 0 {
				return false, ErrDenied
			}
		default:
			return false, ErrDenied
		}
	} else if approval.MFAMethod != "" {
		return false, ErrDenied
	}
	bypass := false
	for _, org := range []*deviceOrgPolicy{root, selected} {
		if !org.AuthEnforced && !org.Google {
			continue
		}
		allowed := false
		if org.BypassEnabled {
			var orgRoles []permission.OrganizationSSORole
			for _, role := range p.Roles {
				if role.OrgID == org.ID && role.Active {
					orgRoles = append(orgRoles, role.OrganizationSSORole)
				}
			}
			var err error
			allowed, err = permission.EvaluateOrganizationSSOBypass(orgRoles)
			if err != nil {
				return false, ErrDenied
			}
		}
		if allowed {
			bypass = true
			continue
		}
		if org.Google && approval.AuthMethod != "google" {
			return false, ErrDenied
		}
		if org.AuthEnforced {
			switch approval.AuthMethod {
			case "oidc", "azure-saml", "okta-saml", "jumpcloud-saml", "google-saml", "keycloak-saml":
			default:
				return false, ErrDenied
			}
		}
	}
	return bypass, nil
}

func (p *devicePolicy) member(org uuid.UUID, directOnly bool) bool {
	// A direct membership takes precedence, including a disabled direct row.
	// Pending direct membership must finish the existing organization selection.
	group := false
	for _, membership := range p.Memberships {
		if membership.OrgID != org {
			continue
		}
		accepted := membership.Status == nil || *membership.Status == "accepted"
		if membership.Direct {
			return membership.Active && accepted
		}
		group = group || (membership.Active && accepted)
	}
	return !directOnly && group
}
