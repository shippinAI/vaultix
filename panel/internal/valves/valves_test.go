package valves

import (
	"testing"
	"time"
)

func TestAllValvesClosedByDefault(t *testing.T) {
	var s Set // zero value
	for _, v := range s.Manifest() {
		if v.Enabled {
			t.Errorf("valve %s must be closed by default", v.Name)
		}
	}
}

func TestIPAllowlistOffIsNoOp(t *testing.T) {
	a := NewIPAllowlist(false, nil)
	if !a.Allowed("203.0.113.9:1234") {
		t.Fatal("off allowlist must allow everything")
	}
}

func TestIPAllowlistOnGates(t *testing.T) {
	a := NewIPAllowlist(true, []string{"10.0.0.0/8"})
	if !a.Allowed("10.1.2.3:5555") {
		t.Fatal("in-range must be allowed")
	}
	if a.Allowed("203.0.113.9") {
		t.Fatal("out-of-range must be blocked")
	}
}

func TestRateCapOffIsNoOp(t *testing.T) {
	r := NewRateCap(false, 1)
	for i := 0; i < 100; i++ {
		if !r.Allow("u") {
			t.Fatal("off rate cap must always allow")
		}
	}
}

func TestRateCapOnGatesAndWindows(t *testing.T) {
	r := NewRateCap(true, 2)
	now := time.Now()
	r.now = func() time.Time { return now }
	if !r.Allow("u") || !r.Allow("u") {
		t.Fatal("first two must pass")
	}
	if r.Allow("u") {
		t.Fatal("third within the minute must be blocked")
	}
	// A different user is independent.
	if !r.Allow("other") {
		t.Fatal("per-user counting")
	}
	// After the window, allowed again.
	now = now.Add(61 * time.Second)
	if !r.Allow("u") {
		t.Fatal("after window must allow again")
	}
}

func TestApprovalGate(t *testing.T) {
	if (ApprovalGate{Enabled: false}).Required() {
		t.Fatal("off gate must not require approval")
	}
	if !(ApprovalGate{Enabled: true}).Required() {
		t.Fatal("on gate must require approval")
	}
}

func TestAccessPolicy(t *testing.T) {
	off := AccessPolicy{Enabled: false, Deny: []string{"/prod"}}
	if !off.Allows("/prod/db") {
		t.Fatal("off policy allows everything")
	}
	on := AccessPolicy{Enabled: true, Deny: []string{"/prod"}}
	if on.Allows("/prod/db") {
		t.Fatal("on policy must deny under /prod")
	}
	if !on.Allows("/dev/db") {
		t.Fatal("on policy allows other paths")
	}
}
