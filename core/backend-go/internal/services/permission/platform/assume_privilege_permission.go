package platform

import (
	"github.com/vaultix-cloud/api/internal/vaultixpolicy"

	"github.com/vaultix-cloud/api/internal/services/permission/project"
)

// AssumePrivilegeChecker implements permission checks for assume privilege operations.
type AssumePrivilegeChecker struct {
	ability *vaultixpolicy.Ability
}

// NewAssumePrivilegeChecker creates an AssumePrivilegeChecker from a CASL ability.
func NewAssumePrivilegeChecker(ability *vaultixpolicy.Ability) *AssumePrivilegeChecker {
	return &AssumePrivilegeChecker{ability: ability}
}

// CanAssumeMemberPrivileges checks if the actor can assume another member's privileges.
func (c *AssumePrivilegeChecker) CanAssumeMemberPrivileges() bool {
	return vaultixpolicy.Can(c.ability, project.MemberActionAssumePrivileges, project.MemberSubject{})
}

// CanAssumeIdentityPrivileges checks if the actor can assume an identity's privileges.
func (c *AssumePrivilegeChecker) CanAssumeIdentityPrivileges(identityID string) bool {
	subject := project.IdentitySubject{
		IdentityID: identityID,
	}
	return vaultixpolicy.Can(c.ability, project.IdentityActionAssumePrivileges, subject)
}
