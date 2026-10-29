package secretmanager

import (
	"github.com/vaultix/gocasl"

	"github.com/vaultix/api/internal/services/permission/project"
)

// SecretAccessChecker implements permission checks for secret operations.
// It wraps a gocasl.Ability and checks both new granular permissions
// and legacy DescribeAndReadValue for backwards compatibility.
type SecretAccessChecker struct {
	ability *gocasl.Ability
}

// NewSecretAccessChecker creates a SecretAccessChecker from a CASL ability.
func NewSecretAccessChecker(ability *gocasl.Ability) *SecretAccessChecker {
	return &SecretAccessChecker{ability: ability}
}

// CanDescribeSecrets checks for a possible describe grant before looking up a
// folder. Conditional grants still require CanDescribeSecret on every row.
func (c *SecretAccessChecker) CanDescribeSecrets() bool {
	for _, action := range []gocasl.ActionFor[project.SecretSubject]{project.SecretActionDescribeSecret, project.SecretActionDescribeAndReadValue} {
		granted, denied := false, false
		for _, rule := range gocasl.PossibleRulesFor(c.ability, action) {
			if !rule.Inverted {
				granted = true
			} else if len(rule.Conditions) == 0 && len(rule.Fields) == 0 {
				denied = true
			}
		}
		if granted && !denied {
			return true
		}
	}
	return false
}

// CanDescribeSecret checks if the actor can see that the secret exists (metadata).
// Supports both the new DescribeSecret permission and the legacy DescribeAndReadValue.
func (c *SecretAccessChecker) CanDescribeSecret(env, path, key string, tagSlugs []string) bool {
	subject := project.SecretSubject{
		Environment: env,
		SecretPath:  path,
		SecretName:  key,
		SecretTags:  tagSlugs,
	}

	canDescribe := gocasl.Can(c.ability, project.SecretActionDescribeSecret, subject)
	canLegacy := gocasl.Can(c.ability, project.SecretActionDescribeAndReadValue, subject)

	return canDescribe || canLegacy
}

// CanReadSecretValue checks if the actor can read the decrypted secret value.
// Supports both the new ReadValue permission and the legacy DescribeAndReadValue.
func (c *SecretAccessChecker) CanReadSecretValue(env, path, key string, tagSlugs []string) bool {
	subject := project.SecretSubject{
		Environment: env,
		SecretPath:  path,
		SecretName:  key,
		SecretTags:  tagSlugs,
	}

	canRead := gocasl.Can(c.ability, project.SecretActionReadValue, subject)
	canLegacy := gocasl.Can(c.ability, project.SecretActionDescribeAndReadValue, subject)

	return canRead || canLegacy
}
