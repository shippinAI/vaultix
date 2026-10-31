package permission

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOrganizationSSOBypass_ParityVectors(t *testing.T) {
	data, err := os.ReadFile("testdata/sso-bypass.json")
	require.NoError(t, err)
	var tests []struct {
		Name  string `json:"name"`
		Roles []struct {
			Role        string          `json:"role"`
			Permissions json.RawMessage `json:"permissions"`
		} `json:"roles"`
		Allowed bool `json:"allowed"`
	}
	require.NoError(t, json.Unmarshal(data, &tests))
	require.NotEmpty(t, tests)
	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			var roles []roleWithPermissions
			var snapshot []OrganizationSSORole
			for _, role := range test.Roles {
				rules := string(role.Permissions)
				roles = append(roles, roleWithPermissions{Role: role.Role, Permissions: &rules})
				snapshot = append(snapshot, OrganizationSSORole{Role: role.Role, Permissions: &rules})
			}
			allowed, err := organizationSSOBypass(roles)
			require.NoError(t, err)
			require.Equal(t, test.Allowed, allowed)
			allowed, err = EvaluateOrganizationSSOBypass(snapshot)
			require.NoError(t, err)
			require.Equal(t, test.Allowed, allowed)
		})
	}
}

func TestOrganizationSSOBypass_InvalidRulesFailClosed(t *testing.T) {
	for _, raw := range []string{"null", `{}`, `not-json`, `[null]`, `[["bypass-sso-enforcement"]]`, `[[1,"sso"]]`, `[["bypass-sso-enforcement",false]]`, `[["bypass-sso-enforcement","sso",42]]`, `[["bypass-sso-enforcement","sso",0,2]]`, `[["bypass-sso-enforcement","sso",0,0,[]]]`, `[["bypass-sso-enforcement","sso",0,0,0,42]]`} {
		t.Run(raw, func(t *testing.T) {
			allowed, err := organizationSSOBypass([]roleWithPermissions{{Role: "admin"}, {Role: "custom", Permissions: &raw}})
			require.Error(t, err)
			require.False(t, allowed)
			require.NotContains(t, err.Error(), raw)
		})
	}
	for _, role := range []string{"custom", "unknown"} {
		allowed, err := organizationSSOBypass([]roleWithPermissions{{Role: "admin"}, {Role: role}})
		require.Error(t, err)
		require.False(t, allowed)
	}
}

func FuzzSSOBypassPackedRules(f *testing.F) {
	f.Add(`[["bypass-sso-enforcement","sso"]]`)
	f.Add(`[["bypass-sso-enforcement","sso",0,1]]`)
	f.Add(`null`)
	f.Fuzz(func(t *testing.T, raw string) {
		allowed, err := organizationSSOBypass([]roleWithPermissions{{Role: "custom", Permissions: &raw}})
		if err != nil {
			require.False(t, allowed)
		}
	})
}
