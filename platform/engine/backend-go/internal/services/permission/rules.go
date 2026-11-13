package permission

import (
	"fmt"
	"slices"

	"github.com/vaultix-cloud/api/internal/vaultixpolicy"

	"github.com/vaultix-cloud/api/internal/services/permission/project"
)

// roleWithPermissions pairs a role slug with its optional custom permissions JSON.
type roleWithPermissions struct {
	Role        string
	Permissions *string
}

// buildProjectPermissionRules maps role slugs to their builtin JSONRule sets and
// validates and unpacks custom roles via vaultixpolicy.DecodePackedRules.
// Returns the combined rules and any parse errors encountered (fail-closed: invalid
// custom roles yield no rules but parsing continues for other roles).
// The persisted encoding is shared with the existing TypeScript permission service.
func buildProjectPermissionRules(roles []roleWithPermissions) ([]vaultixpolicy.JSONRule, []error) {
	var allRules []vaultixpolicy.JSONRule
	var parseErrors []error

	for _, roleEntry := range roles {
		switch roleEntry.Role {
		case project.RoleAdmin:
			allRules = append(allRules, project.AdminPermissions...)
		case project.RoleMember:
			allRules = append(allRules, project.MemberPermissions...)
		case project.RoleViewer:
			allRules = append(allRules, project.ViewerPermissions...)
		case project.RoleNoAccess:
			allRules = append(allRules, project.NoAccessPermissions...)
		case project.RoleKmsCryptographicOperator:
			allRules = append(allRules, project.CryptographicOperatorPermissions...)
		case project.RoleCustom:
			if roleEntry.Permissions != nil {
				unpacked, err := vaultixpolicy.DecodePackedRules([]byte(*roleEntry.Permissions))
				if err != nil {
					parseErrors = append(parseErrors, fmt.Errorf("custom role permissions parse failed: %w", err))
				} else {
					allRules = append(allRules, unpacked...)
				}
			}
		}
	}

	// Match the TypeScript project permission builder: expand a forbid of the
	// new secret read actions so it also forbids the legacy read action, then
	// place forbids after allows. CASL evaluates the last match, so that order
	// makes a matching forbid win. The native evaluator is deny-first and
	// reaches the same result.
	return orderAllowsBeforeForbids(expandLegacyForbidActions(allRules)), parseErrors
}

type legacyForbidExpansion struct {
	subject    string
	legacy     string
	newActions []string
}

var legacyForbidExpansions = []legacyForbidExpansion{
	{project.SubSecrets, project.SecretActionDescribeAndReadValue.Name(), []string{project.SecretActionReadValue.Name(), project.SecretActionDescribeSecret.Name()}},
	{project.SubMember, project.MemberActionGrantPrivileges.Name(), []string{project.MemberActionAssignRole.Name(), project.MemberActionAssignAdditionalPrivileges.Name()}},
	{project.SubIdentity, project.IdentityActionGrantPrivileges.Name(), []string{project.IdentityActionAssignRole.Name(), project.IdentityActionAssignAdditionalPrivileges.Name()}},
	{project.SubGroups, project.GroupActionGrantPrivileges.Name(), []string{project.GroupActionAssignRole.Name()}},
}

func expandLegacyForbidActions(rules []vaultixpolicy.JSONRule) []vaultixpolicy.JSONRule {
	expanded := make([]vaultixpolicy.JSONRule, len(rules))
	for i, rule := range rules {
		expanded[i] = rule
		if !rule.Inverted || len(rule.Subject) != 1 {
			continue
		}
		for _, expansion := range legacyForbidExpansions {
			if rule.Subject[0] != expansion.subject {
				continue
			}
			coversNewAction, hasLegacy := false, false
			for _, action := range rule.Action {
				if action == expansion.legacy {
					hasLegacy = true
				}
				for _, newer := range expansion.newActions {
					if action == newer {
						coversNewAction = true
					}
				}
			}
			if coversNewAction && !hasLegacy {
				expanded[i].Action = append(append(vaultixpolicy.StringOrSlice{}, rule.Action...), expansion.legacy)
			}
		}
	}
	return expanded
}

func orderAllowsBeforeForbids(rules []vaultixpolicy.JSONRule) []vaultixpolicy.JSONRule {
	ordered := make([]vaultixpolicy.JSONRule, 0, len(rules))
	forbids := make([]vaultixpolicy.JSONRule, 0)
	for _, rule := range rules {
		if rule.Inverted {
			forbids = append(forbids, rule)
			continue
		}
		ordered = append(ordered, rule)
	}
	return append(ordered, forbids...)
}

// ServiceTokenScope represents a single scope entry from a service token.
type ServiceTokenScope struct {
	Environment string `json:"environment"`
	SecretPath  string `json:"secretPath"`
}

// buildServiceTokenProjectPermission builds scoped rules with $glob conditions
// on secretPath and exact match on environment.
// Port of buildServiceTokenProjectPermission from project-permission.ts:1848-1887.
func buildServiceTokenProjectPermission(scopes []ServiceTokenScope, permissions []string) []vaultixpolicy.JSONRule {
	canWrite := containsString(permissions, "write")
	canRead := containsString(permissions, "read")

	subjects := vaultixpolicy.StringOrSlice{
		project.SubSecrets,
		project.SubSecretImports,
		project.SubSecretFolders,
	}

	var rules []vaultixpolicy.JSONRule
	for _, scope := range scopes {
		cond := vaultixpolicy.Cond{
			"secretPath":  vaultixpolicy.Op{"$glob": scope.SecretPath},
			"environment": scope.Environment,
		}

		if canWrite {
			rules = append(rules, vaultixpolicy.JSONRule{
				Action:     vaultixpolicy.StringOrSlice{"edit", "create", "delete"},
				Subject:    subjects,
				Conditions: cond,
			})
		}
		if canRead {
			rules = append(rules, vaultixpolicy.JSONRule{
				Action:     vaultixpolicy.StringOrSlice{"read"},
				Subject:    subjects,
				Conditions: cond,
			})
		}
	}

	return rules
}

func containsString(slice []string, target string) bool {
	return slices.Contains(slice, target)
}
