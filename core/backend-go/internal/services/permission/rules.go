package permission

import (
	"fmt"
	"slices"

	"github.com/vaultix/api/internal/vaultixpolicy"

	"github.com/vaultix/api/internal/services/permission/project"
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

	return allRules, parseErrors
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
