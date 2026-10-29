package permission

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/vaultix/gocasl"

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
			rules, err := json.Marshal([]gocasl.JSONRule{{Action: gocasl.StringOrSlice{"describeSecret"}, Subject: gocasl.StringOrSlice{"secrets"}, Conditions: gocasl.Cond{"secretTags": gocasl.Op{scenario.op: []string{"public"}}}}})
			require.NoError(t, err)
			ability, err := gocasl.LoadFromJSON(rules, gocasl.LoadOptions{FieldOps: PermissionFieldOps()})
			require.NoError(t, err)
			require.Equal(t, scenario.want, gocasl.Can(ability, project.SecretActionDescribeSecret, project.SecretSubject{SecretTags: scenario.tags}))
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
				compiled := PermissionFieldOps()[operator].Compile(&gocasl.CompileCtx{Resolve: func(value any) any { return value }}, "name", []string{"public"})
				require.Equal(t, scenario.want != (operator == "$nin"), compiled(gocasl.MapSubject{"name": scenario.field}))
			}
		})
	}
}

func TestPermissionArrayMembership_ConditionsAndDenyRemainEffective(t *testing.T) {
	ability, err := gocasl.LoadFromJSON([]byte(`[
		{"action":"describeSecret","subject":"secrets","conditions":{"environment":"dev","secretTags":{"$in":"{{ .tags }}"}}},
		{"action":"describeSecret","subject":"secrets","inverted":true,"conditions":{"secretTags":{"$in":["restricted"]}}}
	]`), gocasl.LoadOptions{FieldOps: PermissionFieldOps(), Vars: map[string]any{"tags": []string{"public"}}})
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
			require.Equal(t, scenario.want, gocasl.Can(ability, project.SecretActionDescribeSecret, project.SecretSubject{Environment: scenario.env, SecretTags: scenario.tags}))
		})
	}
}
