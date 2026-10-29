package secretmanager

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/vaultix/gocasl"
)

func TestCanDescribeSecrets_RequiresGrantAndPreservesRowChecks(t *testing.T) {
	for _, scenario := range []struct {
		name, rules               string
		possible, allowed, denied bool
	}{
		{"none", `[]`, false, false, false},
		{"value-only", `[{"action":"readValue","subject":"secrets"}]`, false, false, false},
		{"describe", `[{"action":"describeSecret","subject":"secrets"}]`, true, true, true},
		{"legacy", `[{"action":"read","subject":"secrets"}]`, true, true, true},
		{"conditional", `[{"action":"describeSecret","subject":"secrets","conditions":{"secretName":"ALLOWED"}}]`, true, true, false},
		{"conditional-deny", `[{"action":"describeSecret","subject":"secrets"},{"action":"describeSecret","subject":"secrets","inverted":true,"conditions":{"secretName":"DENIED"}}]`, true, true, false},
		{"blanket-deny", `[{"action":"describeSecret","subject":"secrets"},{"action":"describeSecret","subject":"secrets","inverted":true}]`, false, false, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ability, err := gocasl.LoadFromJSON([]byte(scenario.rules), gocasl.LoadOptions{})
			require.NoError(t, err)
			checker := NewSecretAccessChecker(ability)
			require.Equal(t, scenario.possible, checker.CanDescribeSecrets())
			require.Equal(t, scenario.allowed, checker.CanDescribeSecret("dev", "/", "ALLOWED", nil))
			require.Equal(t, scenario.denied, checker.CanDescribeSecret("dev", "/", "DENIED", nil))
		})
	}
}
