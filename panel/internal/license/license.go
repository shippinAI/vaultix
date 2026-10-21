package license

import (
	"encoding/json"
	"os"
	"strings"
)

// AngryVibes identity. This is the living stamp — not a leftover vendor.
const (
	Owner   = "AngryVibes LLC"
	Host    = "shippin.ai"
	Product = "vaultix"
	Stamp   = "A SHIPPIN.AI SERVICE"
)

type Tier string

const (
	Community  Tier = "community"
	Membership Tier = "membership" // shippin.ai member
	Enterprise Tier = "enterprise"
)

// Feature ids match valve names where they share a request-flow gate.
const (
	FeatCore         = "core"
	FeatCatalog      = "catalog"
	FeatConfigure    = "configure"
	FeatMCP          = "mcp"
	FeatApproval     = "approval-gate"
	FeatAuditStream  = "audit-stream"
	FeatIPAllowlist  = "ip-allowlist"
	FeatAccessPolicy = "access-policy"
	FeatRateCap      = "rate-cap"
	FeatMeter        = "meter"
	FeatRotate       = "rotate"
	FeatTeam         = "team"
	FeatHealthScan   = "health-scan"
	FeatSync         = "sync"
)

// Grant is the live entitlement. No leftover license phone-home.
type Grant struct {
	Owner    string   `json:"owner"`
	Host     string   `json:"host"`
	Product  string   `json:"product"`
	Stamp    string   `json:"stamp"`
	Tier     Tier     `json:"tier"`
	Subject  string   `json:"subject,omitempty"`
	Issuer   string   `json:"issuer"`
	Features []string `json:"features"`
}

func CommunityGrant() Grant {
	return grant(Community, "")
}

func grant(tier Tier, subject string) Grant {
	t := Normalize(tier)
	return Grant{
		Owner: Owner, Host: Host, Product: Product, Stamp: Stamp,
		Tier: t, Subject: subject, Issuer: Host,
		Features: featuresFor(t),
	}
}

func Normalize(t Tier) Tier {
	switch Tier(strings.ToLower(strings.TrimSpace(string(t)))) {
	case Membership, "member", "hosted", "shippin":
		return Membership
	case Enterprise, "commercial", "ee":
		return Enterprise
	default:
		return Community
	}
}

func featuresFor(t Tier) []string {
	core := []string{FeatCore, FeatCatalog, FeatConfigure, FeatMCP}
	switch t {
	case Membership:
		return append(append([]string{}, core...), FeatAuditStream, FeatIPAllowlist, FeatRateCap, FeatRotate, FeatSync)
	case Enterprise:
		return append(append([]string{}, core...),
			FeatAuditStream, FeatIPAllowlist, FeatRateCap, FeatRotate, FeatSync,
			FeatApproval, FeatAccessPolicy, FeatMeter, FeatTeam, FeatHealthScan)
	default:
		return core
	}
}

func (g Grant) Allows(feature string) bool {
	if feature == "" || feature == FeatCore {
		return true
	}
	for _, f := range g.Features {
		if f == feature {
			return true
		}
	}
	return false
}

// Open is the activation rule: operator asked AND the grant includes it.
func (g Grant) Open(feature string, asked bool) bool {
	return asked && g.Allows(feature)
}

func Requires(feature string) Tier {
	switch feature {
	case FeatApproval, FeatAccessPolicy, FeatMeter, FeatTeam, FeatHealthScan:
		return Enterprise
	case FeatAuditStream, FeatIPAllowlist, FeatRateCap, FeatRotate, FeatSync:
		return Membership
	default:
		return Community
	}
}

// Load reads operator config. File is optional JSON {tier,subject}.
// Env VAULTIX_LICENSE_TIER wins over file. Missing everything = community.
func Load(tierEnv, file, subject string) Grant {
	t := Community
	sub := strings.TrimSpace(subject)
	if file != "" {
		if raw, err := os.ReadFile(file); err == nil {
			var in struct {
				Tier    string `json:"tier"`
				Subject string `json:"subject"`
				Owner   string `json:"owner"`
				Product string `json:"product"`
			}
			if json.Unmarshal(raw, &in) == nil {
				if in.Tier != "" {
					t = Normalize(Tier(in.Tier))
				}
				if sub == "" {
					sub = in.Subject
				}
			}
		}
	}
	if tierEnv != "" {
		t = Normalize(Tier(tierEnv))
	}
	return grant(t, sub)
}
