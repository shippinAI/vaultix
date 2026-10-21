// Package usage is the plan/usage-metering capability (doc 0010, gaps-4).
//
// Deliberately OPTIONAL. The estate anti-goal (doc 0003) is to never impose
// seat/project meters on a self-hosted private community — so enforcement is
// OFF by default and every limit defaults to unlimited. What this package
// buys is that the *option* exists: turning metering on later is a config
// flag, not a schema migration or a retrofit. Build the plumbing now, leave
// the valve closed.
package usage

// Feature is a meterable resource, named to mirror the Doppler surface so a
// future comparison/plan maps 1:1.
type Feature string

const (
	Projects        Feature = "projects"
	ConfigSyncs     Feature = "config-syncs"
	ServiceTokens   Feature = "service-tokens"
	Webhooks        Feature = "webhooks"
	Reminders       Feature = "recurring-reminders"
	RotatedSecrets  Feature = "rotated-secrets"
	Integrations    Feature = "integrations"
	WorkplaceUsers  Feature = "workplace-users"
	ServiceAccounts Feature = "service-accounts"
)

// Labels are plain-language, for the meter view.
var Labels = map[Feature]string{
	Projects:        "Projects",
	ConfigSyncs:     "Config Syncs",
	ServiceTokens:   "Service Tokens",
	Webhooks:        "Webhooks",
	Reminders:       "Recurring Reminders",
	RotatedSecrets:  "Rotated Secrets",
	Integrations:    "Integrations",
	WorkplaceUsers:  "Workplace Users",
	ServiceAccounts: "Service Accounts",
}

// Order is the stable display order for the meter view.
var Order = []Feature{
	Projects, ConfigSyncs, ServiceTokens, Webhooks, Reminders,
	RotatedSecrets, Integrations, WorkplaceUsers, ServiceAccounts,
}

// Plan is a set of per-feature limits. Limit 0 = unlimited (the default for
// every feature — self-host has no meter unless an operator sets one).
type Plan struct {
	Name   string          `json:"name"`
	Limits map[Feature]int `json:"limits"`
}

// Unlimited is the default plan: every feature unlimited. This is what a
// private-cloud install runs with.
func Unlimited() Plan {
	return Plan{Name: "unlimited", Limits: map[Feature]int{}}
}

func (p Plan) limit(f Feature) int { return p.Limits[f] } // 0 = unlimited

// Snapshot is the current count per feature, gathered by the caller.
type Snapshot map[Feature]int

// FeatureUsage is one meter row (mirrors gaps-4).
type FeatureUsage struct {
	Feature   Feature `json:"feature"`
	Label     string  `json:"label"`
	Used      int     `json:"used"`
	Limit     int     `json:"limit"` // 0 when unlimited
	Unlimited bool    `json:"unlimited"`
	OverLimit bool    `json:"overLimit"` // used > limit (informational; not enforced unless Meter.Enforce)
}

// Report renders the meter view for a plan + snapshot. Always shows every
// feature, so the view is complete even at zero.
func Report(plan Plan, snap Snapshot) []FeatureUsage {
	out := make([]FeatureUsage, 0, len(Order))
	for _, f := range Order {
		lim := plan.limit(f)
		used := snap[f]
		out = append(out, FeatureUsage{
			Feature:   f,
			Label:     Labels[f],
			Used:      used,
			Limit:     lim,
			Unlimited: lim == 0,
			OverLimit: lim > 0 && used > lim,
		})
	}
	return out
}

// Meter decides whether an action that would consume a feature is allowed.
// Enforce defaults false — the valve. When off, everything is allowed
// regardless of limits, so metering is purely observational until an
// operator opts in.
type Meter struct {
	Plan    Plan
	Enforce bool
}

// Allow reports whether creating one more of feature f is permitted, given
// the current count. The reason is empty when allowed.
func (m Meter) Allow(f Feature, current int) (bool, string) {
	if !m.Enforce {
		return true, ""
	}
	lim := m.Plan.limit(f)
	if lim == 0 { // unlimited
		return true, ""
	}
	if current >= lim {
		return false, "plan limit reached for " + string(f)
	}
	return true, ""
}
