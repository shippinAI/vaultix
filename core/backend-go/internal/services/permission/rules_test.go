package permission

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/vaultixpolicy"

	"github.com/vaultix/api/internal/services/permission/project"
)

// ---- buildProjectPermissionRules ----

func TestBuildProjectPermissionRules_BuiltinRoles(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		role         string
		minRuleCount int // at least this many rules
	}{
		{"admin", project.RoleAdmin, len(project.AdminPermissions)},
		{"member", project.RoleMember, len(project.MemberPermissions)},
		{"viewer", project.RoleViewer, len(project.ViewerPermissions)},
		{"no-access", project.RoleNoAccess, 0},
		{"cryptographic-operator", project.RoleKmsCryptographicOperator, len(project.CryptographicOperatorPermissions)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			roles := []roleWithPermissions{{Role: tt.role}}
			rules, errs := buildProjectPermissionRules(roles)
			assert.Len(t, rules, tt.minRuleCount)
			assert.Empty(t, errs, "builtin roles should not produce parse errors")
		})
	}
}

func TestBuildProjectPermissionRules_CustomRole(t *testing.T) {
	t.Parallel()

	// PackedRule format: [actions, subject, conditions, inverted]
	packed := []vaultixpolicy.PackedRule{
		{
			vaultixpolicy.StringOrSlice{"read"},
			vaultixpolicy.StringOrSlice{project.SubSecrets},
			vaultixpolicy.Cond{"environment": "prod"},
			false,
		},
	}
	packedJSON, err := json.Marshal(packed)
	require.NoError(t, err)
	packedStr := string(packedJSON)

	roles := []roleWithPermissions{{Role: project.RoleCustom, Permissions: &packedStr}}
	rules, errs := buildProjectPermissionRules(roles)

	require.Len(t, rules, 1)
	assert.Empty(t, errs)
	assert.Equal(t, vaultixpolicy.StringOrSlice{"read"}, rules[0].Action)
	assert.Equal(t, vaultixpolicy.StringOrSlice{project.SubSecrets}, rules[0].Subject)
	assert.Equal(t, "prod", rules[0].Conditions["environment"])
}

func TestBuildProjectPermissionRules_CustomRoleNilPermissions(t *testing.T) {
	t.Parallel()

	roles := []roleWithPermissions{{Role: project.RoleCustom, Permissions: nil}}
	rules, errs := buildProjectPermissionRules(roles)
	assert.Empty(t, rules, "nil permissions must produce no rules")
	assert.Empty(t, errs, "nil permissions should not produce parse errors")
}

func TestBuildProjectPermissionRules_CustomRoleInvalidJSON(t *testing.T) {
	t.Parallel()

	badJSON := "not valid json"
	roles := []roleWithPermissions{{Role: project.RoleCustom, Permissions: &badJSON}}
	rules, errs := buildProjectPermissionRules(roles)
	assert.Empty(t, rules, "invalid JSON must produce no rules (fail-closed)")
	assert.Len(t, errs, 1, "invalid JSON must return parse error")
}

func TestBuildProjectPermissionRules_MalformedConstraintsDoNotGrant(t *testing.T) {
	t.Parallel()
	for _, packed := range []string{
		`[["read","secrets",42]]`,
		`[["read","secrets",{"environment":"prod"},"deny"]]`,
		`[["read","secrets",0,false,["environment",42]]]`,
	} {
		t.Run(packed, func(t *testing.T) {
			rules, errs := buildProjectPermissionRules([]roleWithPermissions{{Role: project.RoleCustom, Permissions: &packed}})
			require.Empty(t, rules)
			require.Len(t, errs, 1)
			encoded, err := json.Marshal(rules)
			require.NoError(t, err)
			ability, err := vaultixpolicy.LoadFromJSON(encoded, vaultixpolicy.LoadOptions{})
			require.NoError(t, err)
			assert.False(t, vaultixpolicy.Can(ability, project.SecretActionReadValue, project.SecretSubject{Environment: "prod"}))
		})
	}
	valid := `[["readValue","secrets",{"environment":"prod"}]]`
	rules, errs := buildProjectPermissionRules([]roleWithPermissions{{Role: project.RoleCustom, Permissions: &valid}})
	require.Empty(t, errs)
	encoded, err := json.Marshal(rules)
	require.NoError(t, err)
	ability, err := vaultixpolicy.LoadFromJSON(encoded, vaultixpolicy.LoadOptions{})
	require.NoError(t, err)
	assert.True(t, vaultixpolicy.Can(ability, project.SecretActionReadValue, project.SecretSubject{Environment: "prod"}))
	assert.False(t, vaultixpolicy.Can(ability, project.SecretActionReadValue, project.SecretSubject{Environment: "dev"}))
}

func TestBuildProjectPermissionRules_UnknownRoleProducesNothing(t *testing.T) {
	t.Parallel()

	roles := []roleWithPermissions{{Role: "unknown-role-slug"}}
	rules, errs := buildProjectPermissionRules(roles)
	assert.Empty(t, rules)
	assert.Empty(t, errs)
}

func TestBuildProjectPermissionRules_InvertedRulesPreserved(t *testing.T) {
	t.Parallel()

	// Create a custom role with an inverted (forbid) rule + a non-inverted rule.
	// vaultixpolicy auto-prioritizes forbid rules at evaluation time.
	packed := []vaultixpolicy.PackedRule{
		// inverted rule (deny read secrets)
		{vaultixpolicy.StringOrSlice{"read"}, vaultixpolicy.StringOrSlice{project.SubSecrets}, nil, true},
		// allow rule
		{vaultixpolicy.StringOrSlice{"create"}, vaultixpolicy.StringOrSlice{project.SubSecrets}, nil, false},
	}
	packedJSON, err := json.Marshal(packed)
	require.NoError(t, err)
	packedStr := string(packedJSON)

	roles := []roleWithPermissions{{Role: project.RoleCustom, Permissions: &packedStr}}
	rules, errs := buildProjectPermissionRules(roles)

	require.Len(t, rules, 2)
	assert.Empty(t, errs)

	hasAllow := false
	hasForbid := false
	for _, r := range rules {
		if r.Inverted {
			hasForbid = true
		} else {
			hasAllow = true
		}
	}
	assert.True(t, hasAllow, "must have allow rule")
	assert.True(t, hasForbid, "must have forbid rule")
}

func TestBuildProjectPermissionRules_MultipleRolesMerge(t *testing.T) {
	t.Parallel()

	roles := []roleWithPermissions{
		{Role: project.RoleViewer},
		{Role: project.RoleKmsCryptographicOperator},
	}
	rules, errs := buildProjectPermissionRules(roles)

	expectedLen := len(project.ViewerPermissions) + len(project.CryptographicOperatorPermissions)
	assert.Len(t, rules, expectedLen, "rules from multiple roles must be merged")
	assert.Empty(t, errs)
}

// ---- buildServiceTokenProjectPermission ----

func TestBuildServiceTokenProjectPermission_ReadOnly(t *testing.T) {
	t.Parallel()

	scopes := []ServiceTokenScope{
		{Environment: "prod", SecretPath: "/app/**"},
	}
	rules := buildServiceTokenProjectPermission(scopes, []string{"read"})

	require.Len(t, rules, 1, "read-only should produce 1 rule")
	assert.Equal(t, vaultixpolicy.StringOrSlice{"read"}, rules[0].Action)
	assert.Equal(t, vaultixpolicy.Op{"$glob": "/app/**"}, rules[0].Conditions["secretPath"])
	assert.Equal(t, "prod", rules[0].Conditions["environment"])
}

func TestBuildServiceTokenProjectPermission_WriteOnly(t *testing.T) {
	t.Parallel()

	scopes := []ServiceTokenScope{
		{Environment: "staging", SecretPath: "/"},
	}
	rules := buildServiceTokenProjectPermission(scopes, []string{"write"})

	require.Len(t, rules, 1, "write-only should produce 1 rule")
	assert.Equal(t, vaultixpolicy.StringOrSlice{"edit", "create", "delete"}, rules[0].Action)
}

func TestBuildServiceTokenProjectPermission_ReadWrite(t *testing.T) {
	t.Parallel()

	scopes := []ServiceTokenScope{
		{Environment: "prod", SecretPath: "/"},
	}
	rules := buildServiceTokenProjectPermission(scopes, []string{"read", "write"})

	require.Len(t, rules, 2, "read+write should produce 2 rules")
}

func TestBuildServiceTokenProjectPermission_MultipleScopes(t *testing.T) {
	t.Parallel()

	scopes := []ServiceTokenScope{
		{Environment: "prod", SecretPath: "/app/**"},
		{Environment: "staging", SecretPath: "/"},
	}
	rules := buildServiceTokenProjectPermission(scopes, []string{"read"})

	require.Len(t, rules, 2, "should produce 1 rule per scope")
	assert.Equal(t, "prod", rules[0].Conditions["environment"])
	assert.Equal(t, "staging", rules[1].Conditions["environment"])
}

func TestBuildServiceTokenProjectPermission_NoPermissions(t *testing.T) {
	t.Parallel()

	scopes := []ServiceTokenScope{
		{Environment: "prod", SecretPath: "/"},
	}
	rules := buildServiceTokenProjectPermission(scopes, []string{})
	assert.Empty(t, rules, "no permissions should produce no rules")
}

func TestBuildServiceTokenProjectPermission_SubjectsIncludeAll(t *testing.T) {
	t.Parallel()

	scopes := []ServiceTokenScope{
		{Environment: "prod", SecretPath: "/"},
	}
	rules := buildServiceTokenProjectPermission(scopes, []string{"read"})

	require.Len(t, rules, 1)
	assert.Contains(t, []string(rules[0].Subject), project.SubSecrets)
	assert.Contains(t, []string(rules[0].Subject), project.SubSecretImports)
	assert.Contains(t, []string(rules[0].Subject), project.SubSecretFolders)
}
