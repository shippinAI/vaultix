package usage

import "testing"

func TestUnlimitedByDefault(t *testing.T) {
	p := Unlimited()
	rep := Report(p, Snapshot{Projects: 999})
	var proj *FeatureUsage
	for i := range rep {
		if rep[i].Feature == Projects {
			proj = &rep[i]
		}
	}
	if proj == nil || !proj.Unlimited || proj.Used != 999 || proj.OverLimit {
		t.Fatalf("default plan must be unlimited: %+v", proj)
	}
	if len(rep) != len(Order) {
		t.Fatalf("report must list every feature, got %d", len(rep))
	}
}

func TestEnforcementOffAllowsOverLimit(t *testing.T) {
	// A plan WITH a limit, but Enforce off -> still allowed (the valve).
	m := Meter{Plan: Plan{Name: "team", Limits: map[Feature]int{Projects: 10}}, Enforce: false}
	if ok, _ := m.Allow(Projects, 50); !ok {
		t.Fatal("enforcement off must allow over-limit")
	}
}

func TestEnforcementOnGates(t *testing.T) {
	m := Meter{Plan: Plan{Name: "team", Limits: map[Feature]int{Projects: 10}}, Enforce: true}
	if ok, _ := m.Allow(Projects, 9); !ok {
		t.Fatal("under limit must be allowed")
	}
	ok, reason := m.Allow(Projects, 10)
	if ok || reason == "" {
		t.Fatalf("at/over limit must be blocked with a reason, got ok=%v reason=%q", ok, reason)
	}
}

func TestEnforcementOnButUnlimitedFeatureAllowed(t *testing.T) {
	// Enforce on, but this feature has no limit set (0 = unlimited).
	m := Meter{Plan: Plan{Name: "team", Limits: map[Feature]int{Projects: 10}}, Enforce: true}
	if ok, _ := m.Allow(Webhooks, 1000); !ok {
		t.Fatal("feature with no limit must be allowed even when enforcing")
	}
}

func TestReportFlagsOverLimitInformationally(t *testing.T) {
	p := Plan{Name: "team", Limits: map[Feature]int{Projects: 2}}
	rep := Report(p, Snapshot{Projects: 5})
	for _, r := range rep {
		if r.Feature == Projects {
			if !r.OverLimit || r.Limit != 2 || r.Used != 5 {
				t.Fatalf("over-limit not flagged: %+v", r)
			}
		}
	}
}
