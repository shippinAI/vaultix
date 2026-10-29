package permission

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
)

const ssoBypassAction = "bypass-sso-enforcement"

// enforceProjectSSO uses the authenticated method, never a request-body field.
// Machine/service actors have separate authentication policies. Empty native
// methods cannot represent the trusted null exemption used by TypeScript jobs.
func (s *Service) enforceProjectSSO(ctx context.Context, args *GetProjectPermissionArgs, policy *permissionData) error {
	if args.Actor != auth.ActorTypeUser {
		return nil
	}
	saml := policy.OrgAuthEnforced.Valid && policy.OrgAuthEnforced.V
	google := policy.OrgGoogleSsoAuthEnforced
	if !saml && !google {
		return nil
	}
	if args.ActorAuthMethod == "" {
		return errutil.Unauthorized("Sign in again to verify your authentication method")
	}
	if policy.BypassOrgAuthEnabled {
		orgID := policy.ScopeOrgID
		if policy.RootOrgID.Valid {
			orgID = policy.RootOrgID.V
		}
		memberships, err := s.getPermission(ctx, &getPermissionParams{
			Scope: AccessScopeOrganization, OrgID: orgID, ActorID: args.ActorID, ActorType: auth.ActorTypeUser,
		})
		if err != nil {
			return errutil.DatabaseErr("resolving organization SSO policy").WithErr(err)
		}
		bypass, err := organizationSSOBypass(flattenActiveRolesFromMemberships(memberships))
		if err != nil {
			return errutil.InternalServer("Organization SSO policy is unavailable").WithErr(err)
		}
		if bypass {
			return nil
		}
	}
	if google && args.ActorAuthMethod != "google" {
		return errutil.Forbidden("Organization authentication is enforced. Sign in with Google SSO to access this resource.")
	}
	if saml {
		switch args.ActorAuthMethod {
		case "azure-saml", "okta-saml", "jumpcloud-saml", "google-saml", "keycloak-saml", "oidc":
		default:
			return errutil.Forbidden("Organization authentication is enforced. Sign in with SAML SSO or OIDC to access this resource.")
		}
	}
	return nil
}

// organizationSSOBypass projects exactly one organization capability. It is not
// a general org permission resolver. TypeScript asks CASL about the subject TYPE
// "sso", without a resource or field. Conditional/field allow rules participate;
// conditional/field deny rules do not. Unconditional denies sort after all allows
// in the existing policy and therefore win, irrespective of membership order.
func organizationSSOBypass(roles []roleWithPermissions) (bool, error) {
	granted, denied := false, false
	for _, role := range roles {
		switch role.Role {
		case "admin":
			granted = true
		case "member", "no-access":
		case "custom":
			if role.Permissions == nil {
				return false, errors.New("missing organization role rules")
			}
			var rules [][]any
			if err := json.Unmarshal([]byte(*role.Permissions), &rules); err != nil || rules == nil {
				return false, errors.New("invalid organization role rules")
			}
			for _, rule := range rules {
				allow, forbid, err := ssoRuleEffect(rule)
				if err != nil {
					return false, err
				}
				granted = granted || allow
				denied = denied || forbid
			}
		default:
			return false, errors.New("unknown organization role")
		}
	}
	return granted && !denied, nil
}

func ssoRuleNames(raw any) ([]string, bool) {
	switch value := raw.(type) {
	case string:
		return strings.Split(value, ","), value != ""
	case []any:
		names := make([]string, 0, len(value))
		for _, item := range value {
			name, ok := item.(string)
			if !ok || name == "" {
				return nil, false
			}
			names = append(names, name)
		}
		return names, len(names) > 0
	default:
		return nil, false
	}
}

// Validate packed fields before projecting them; malformed conditions must not
// silently become an unrestricted allow or erase an unconditional deny.
func ssoRuleEffect(rule []any) (allow, forbid bool, err error) {
	invalid := errors.New("invalid packed organization rule")
	if len(rule) < 2 || len(rule) > 6 {
		return false, false, invalid
	}
	actions, ok := ssoRuleNames(rule[0])
	if !ok {
		return false, false, invalid
	}
	subjects, ok := ssoRuleNames(rule[1])
	if !ok {
		return false, false, invalid
	}
	conditional, fields, inverted := false, false, false
	if len(rule) > 2 {
		switch value := rule[2].(type) {
		case nil:
		case float64:
			if value != 0 {
				return false, false, invalid
			}
		case map[string]any:
			conditional = true // An empty object is also truthy in CASL.
		default:
			return false, false, invalid
		}
	}
	if len(rule) > 3 {
		switch value := rule[3].(type) {
		case nil:
		case bool:
			inverted = value
		case float64:
			if value != 0 && value != 1 {
				return false, false, invalid
			}
			inverted = value == 1
		default:
			return false, false, invalid
		}
	}
	if len(rule) > 4 && rule[4] != nil {
		if number, isNumber := rule[4].(float64); isNumber && number == 0 {
			// Packed placeholder: no field restriction.
		} else {
			_, valid := ssoRuleNames(rule[4])
			if !valid {
				return false, false, invalid
			}
			fields = true
		}
	}
	if len(rule) > 5 && rule[5] != nil {
		if _, valid := rule[5].(string); !valid {
			return false, false, invalid
		}
	}
	matches := (slices.Contains(actions, ssoBypassAction) || slices.Contains(actions, "manage")) &&
		(slices.Contains(subjects, "sso") || slices.Contains(subjects, "all"))
	return matches && !inverted, matches && inverted && !conditional && !fields, nil
}
