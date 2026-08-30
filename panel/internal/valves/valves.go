// Package valves is the estate's dormant-capability set (doc 0003 gap
// ledger, doc 0010). Each valve is a real capability whose enforcement is
// OFF by default — so turning it on later is a config flag, never a schema
// migration or a request-flow retrofit. Build the plumbing during
// pre-release; leave the valves closed.
//
// Every valve here touches request flow or data shape — exactly the class
// that is cheap to stub now and painful to add once there is live traffic
// and data. Observational/discoverable via the capabilities manifest.
package valves

import (
	"net"
	"sync"
	"time"
)

// State describes one valve for the capabilities manifest.
type State struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	Enabled   bool   `json:"enabled"`
	Licensed  bool   `json:"licensed"`
	Requires  string `json:"requires"`
	Detail    string `json:"detail"`
}

// Set is the full valve configuration. Zero value = every valve closed,
// which is the private-cloud default. (RateCap holds state, so it lives on
// the Server as a pointer, not here.)
type Set struct {
	IPAllowlist  IPAllowlist
	ApprovalGate ApprovalGate
	AuditStream  AuditStream
	AccessPolicy AccessPolicy
}

// Manifest lists every valve and its state — so the option's existence is
// discoverable (panel + Clyffy), even while closed. The rate-cap row's
// Enabled flag is patched in by the caller from the Server's RateCap pointer.
func (s Set) Manifest() []State {
	return []State{
		{Name: "ip-allowlist", Label: "IP allowlist", Enabled: s.IPAllowlist.Enabled,
			Detail: "Restrict panel access to configured source networks."},
		{Name: "rate-cap", Label: "Rate cap", Enabled: false,
			Detail: "Per-user request ceiling on sensitive actions."},
		{Name: "approval-gate", Label: "Approval workflow", Enabled: s.ApprovalGate.Enabled,
			Detail: "Sensitive actions require an approval before applying."},
		{Name: "audit-stream", Label: "Audit stream (SIEM)", Enabled: s.AuditStream.Enabled,
			Detail: "Mirror audit events to an external sink."},
		{Name: "access-policy", Label: "Per-path access policy", Enabled: s.AccessPolicy.Enabled,
			Detail: "Gate secret operations by path policy."},
	}
}

// --- IP allowlist (doc 0003: IP allowlists / gateways) ---

type IPAllowlist struct {
	Enabled bool
	nets    []*net.IPNet
}

// NewIPAllowlist parses CIDRs. Enabled=false makes Allowed always true.
func NewIPAllowlist(enabled bool, cidrs []string) IPAllowlist {
	a := IPAllowlist{Enabled: enabled}
	for _, c := range cidrs {
		if _, n, err := net.ParseCIDR(c); err == nil {
			a.nets = append(a.nets, n)
		}
	}
	return a
}

// Allowed reports whether a source IP may proceed. Off => always true.
func (a IPAllowlist) Allowed(ip string) bool {
	if !a.Enabled {
		return true
	}
	parsed := net.ParseIP(hostOnly(ip))
	if parsed == nil {
		return false
	}
	for _, n := range a.nets {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

func hostOnly(addr string) string {
	if h, _, err := net.SplitHostPort(addr); err == nil {
		return h
	}
	return addr
}

// --- Rate cap ---

type RateCap struct {
	Enabled   bool
	PerMinute int
	now       func() time.Time
	mu        sync.Mutex
	hits      map[string][]time.Time
}

func NewRateCap(enabled bool, perMinute int) *RateCap {
	return &RateCap{Enabled: enabled, PerMinute: perMinute, now: time.Now, hits: map[string][]time.Time{}}
}

// Allow reports whether a user may act now. Off => always true. Counts a hit
// when allowed.
func (r *RateCap) Allow(user string) bool {
	if r == nil || !r.Enabled || r.PerMinute <= 0 {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	cutoff := now.Add(-time.Minute)
	kept := r.hits[user][:0]
	for _, t := range r.hits[user] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= r.PerMinute {
		r.hits[user] = kept
		return false
	}
	r.hits[user] = append(kept, now)
	return true
}

// --- Approval gate (doc 0003: approval workflows / access requests) ---

type ApprovalGate struct{ Enabled bool }

// Required reports whether a sensitive action must be held for approval.
// Off => false (apply immediately).
func (g ApprovalGate) Required() bool { return g.Enabled }

// --- Audit stream / SIEM (doc 0003: audit export / SIEM stream) ---

type AuditStream struct {
	Enabled  bool
	Endpoint string
}

// --- Per-path access policy ---

type AccessPolicy struct {
	Enabled bool
	// denyPaths: exact secretPath prefixes that are blocked when enabled.
	Deny []string
}

// Allows reports whether an operation on secretPath may proceed. Off => true.
func (p AccessPolicy) Allows(secretPath string) bool {
	if !p.Enabled {
		return true
	}
	for _, d := range p.Deny {
		if secretPath == d || (len(secretPath) >= len(d) && secretPath[:len(d)] == d) {
			return false
		}
	}
	return true
}
