package permission

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/vaultixpolicy"

	"github.com/vaultix/api/internal/services/permission/project"
)

func TestPermissionArrayMembership_TagConditions(t *testing.T) {
	for _, scenario := range []struct {
		name, op string
		tags     []string
		want     bool
	}{
		{"in-matches-one", "$in", []string{"other", "public"}, true},
		{"in-misses", "$in", []string{"other"}, false},
		{"in-empty", "$in", []string{}, false},
		{"in-nil", "$in", nil, false},
		{"nin-matches-one", "$nin", []string{"other", "public"}, false},
		{"nin-misses", "$nin", []string{"other"}, true},
		{"nin-empty", "$nin", []string{}, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			rules, err := json.Marshal([]vaultixpolicy.JSONRule{{Action: vaultixpolicy.StringOrSlice{"describeSecret"}, Subject: vaultixpolicy.StringOrSlice{"secrets"}, Conditions: vaultixpolicy.Cond{"secretTags": vaultixpolicy.Op{scenario.op: []string{"public"}}}}})
			require.NoError(t, err)
			ability, err := vaultixpolicy.LoadFromJSON(rules, vaultixpolicy.LoadOptions{FieldOps: PermissionFieldOps()})
			require.NoError(t, err)
			require.Equal(t, scenario.want, vaultixpolicy.Can(ability, project.SecretActionDescribeSecret, project.SecretSubject{SecretTags: scenario.tags}))
		})
	}
}

func TestPermissionArrayMembership_ScalarAndArrayFields(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		field any
		want  bool
	}{
		{"scalar-match", "public", true},
		{"scalar-miss", "private", false},
		{"missing", nil, false},
		{"typed-array", [2]string{"private", "public"}, true},
		{"json-array", []any{"private", "public"}, true},
		{"empty-array", [0]string{}, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			for _, operator := range []string{"$in", "$nin"} {
				compiled := PermissionFieldOps()[operator].Compile(&vaultixpolicy.CompileCtx{Resolve: func(value any) any { return value }}, "name", []string{"public"})
				require.Equal(t, scenario.want != (operator == "$nin"), compiled(vaultixpolicy.MapSubject{"name": scenario.field}))
			}
		})
	}
}

func TestPermissionArrayAllMatchesContainedTags(t *testing.T) {
	for _, scenario := range []struct {
		name string
		all  []string
		tags []string
		want bool
	}{
		{"both", []string{"public", "prod"}, []string{"prod", "public", "extra"}, true},
		{"missing", []string{"public", "prod"}, []string{"public"}, false},
		{"empty-constraint", []string{}, []string{"public"}, true},
		{"empty-field", []string{"public"}, []string{}, false},
		{"nil-field", []string{"public"}, nil, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			rules, err := json.Marshal([]vaultixpolicy.JSONRule{{
				Action: vaultixpolicy.StringOrSlice{"describeSecret"}, Subject: vaultixpolicy.StringOrSlice{"secrets"},
				Conditions: vaultixpolicy.Cond{"secretTags": vaultixpolicy.Op{"$all": scenario.all}},
			}})
			require.NoError(t, err)
			ability, err := vaultixpolicy.LoadFromJSON(rules, vaultixpolicy.LoadOptions{FieldOps: PermissionFieldOps()})
			require.NoError(t, err)
			require.Equal(t, scenario.want, vaultixpolicy.Can(ability, project.SecretActionDescribeSecret, project.SecretSubject{SecretTags: scenario.tags}))
		})
	}
	scalar := PermissionFieldOps()["$all"].Compile(&vaultixpolicy.CompileCtx{Resolve: func(value any) any { return value }}, "secretTags", []string{"public"})
	require.False(t, scalar(vaultixpolicy.MapSubject{"secretTags": "public"}))
}

func TestReferenceEvaluatorStaysDenyFirstUntilCutoverDecision(t *testing.T) {
	// CASL lets the later allow override the earlier forbid. This evaluator
	// still returns false. Public reference routes stay on TypeScript.
	ability, err := vaultixpolicy.LoadFromJSON([]byte(`[
		{"action":"describeSecret","subject":"secrets","inverted":true},
		{"action":"describeSecret","subject":"secrets","conditions":{"secretName":"ALLOWED"}}
	]`), vaultixpolicy.LoadOptions{FieldOps: PermissionFieldOps()})
	require.NoError(t, err)
	require.False(t, vaultixpolicy.Can(ability, project.SecretActionDescribeSecret, project.SecretSubject{SecretName: "ALLOWED"}))
}

func TestPermissionArrayMembership_ConditionsAndDenyRemainEffective(t *testing.T) {
	ability, err := vaultixpolicy.LoadFromJSON([]byte(`[
		{"action":"describeSecret","subject":"secrets","conditions":{"environment":"dev","secretTags":{"$in":"{{ .tags }}"}}},
		{"action":"describeSecret","subject":"secrets","inverted":true,"conditions":{"secretTags":{"$in":["restricted"]}}}
	]`), vaultixpolicy.LoadOptions{FieldOps: PermissionFieldOps(), Vars: map[string]any{"tags": []string{"public"}}})
	require.NoError(t, err)
	for _, scenario := range []struct {
		name, env string
		tags      []string
		want      bool
	}{
		{"matching", "dev", []string{"public"}, true},
		{"other-condition-refuses", "prod", []string{"public"}, false},
		{"matching-deny-refuses", "dev", []string{"public", "restricted"}, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			require.Equal(t, scenario.want, vaultixpolicy.Can(ability, project.SecretActionDescribeSecret, project.SecretSubject{Environment: scenario.env, SecretTags: scenario.tags}))
		})
	}
}
