package license

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCommunityIsAngryVibes(t *testing.T) {
	g := CommunityGrant()
	if g.Owner != Owner || g.Host != Host || g.Product != Product || g.Stamp != Stamp {
		t.Fatalf("%+v", g)
	}
	if g.Tier != Community {
		t.Fatal(g.Tier)
	}
	if !g.Allows(FeatCore) || !g.Allows(FeatCatalog) {
		t.Fatal("community must include core")
	}
	if !g.Allows(FeatApproval) || !g.Allows(FeatMeter) {
		t.Fatal("community must include Vaultix features")
	}
}

func TestMembershipAndEnterprise(t *testing.T) {
	m := Load("membership", "", "member-1")
	if m.Tier != Membership || m.Subject != "member-1" {
		t.Fatalf("%+v", m)
	}
	if !m.Allows(FeatAuditStream) || !m.Allows(FeatApproval) {
		t.Fatalf("membership gates: %+v", m.Features)
	}
	e := Load("enterprise", "", "")
	if !e.Allows(FeatApproval) || !e.Allows(FeatTeam) {
		t.Fatal("enterprise missing valves")
	}
}

func TestOpenNeedsBothAskAndGrant(t *testing.T) {
	c := CommunityGrant()
	if !c.Open(FeatApproval, true) {
		t.Fatal("community must allow approvals when configured")
	}
	e := Load("enterprise", "", "")
	if e.Open(FeatApproval, false) {
		t.Fatal("enterprise must not open approval unless asked")
	}
	if !e.Open(FeatApproval, true) {
		t.Fatal("enterprise+ask should open approval")
	}
}

func TestAllTiersIncludeTheSameFeatures(t *testing.T) {
	for _, tier := range []string{"community", "membership", "enterprise", "unknown"} {
		g := Load(tier, "", "")
		for _, feature := range featuresFor(Community) {
			if !g.Allows(feature) || Requires(feature) != Community || g.Open(feature, false) {
				t.Fatalf("feature %s must be included but opt-in for %s", feature, tier)
			}
		}
		if g.Allows("not-implemented") {
			t.Fatal("unknown features must remain closed")
		}
	}
}

func TestLoadFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "lic.json")
	if err := os.WriteFile(p, []byte(`{"tier":"enterprise","subject":"org-9"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	g := Load("", p, "")
	if g.Tier != Enterprise || g.Subject != "org-9" {
		t.Fatalf("%+v", g)
	}
	envWins := Load("community", p, "")
	if envWins.Tier != Community {
		t.Fatal("env must win over file")
	}
}
