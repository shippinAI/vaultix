package runtime

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCatalogLaw(t *testing.T) {
	c := Catalog()
	if len(c) < 5 {
		t.Fatalf("thin catalog: %d", len(c))
	}
	for _, e := range c {
		if strings.Contains(strings.ToLower(e.Body), "sk-") {
			t.Fatalf("catalog body looks like a secret: %s", e.ID)
		}
	}
}

func TestDecideCatalogWins(t *testing.T) {
	a := Decide("s1", Trigger{Kind: "glossary-term", Term: "Box"}, DecideOpts{})
	b := Decide("s1", Trigger{Kind: "glossary-term", Term: "box"}, DecideOpts{})
	if a.Serve != SourceCatalog || a.Reason != ReasonCatalogMatch || a.EntryID != "knowledge.glossary.box" {
		t.Fatalf("want catalog box, got %+v", a)
	}
	ra, _ := json.Marshal(a)
	rb, _ := json.Marshal(b)
	if string(ra) != string(rb) {
		t.Fatal("decide is not deterministic on term case")
	}
	if a.Serve == SourceML {
		t.Fatal("ml valve opened")
	}
	raw := string(ra)
	if strings.Contains(strings.ToLower(raw), "valutix") {
		t.Fatal("catalog mentioned leftover brand")
	}
}

func TestDecideNoSilentFrontier(t *testing.T) {
	d := Decide("s", Trigger{Kind: "glossary-term", Term: "not-a-term"}, DecideOpts{})
	if d.Reason != ReasonNoCatalogEntry || d.Serve != SourceFrontier {
		t.Fatalf("want recorded miss, got %+v", d)
	}
	if len(d.Messages) != 0 {
		t.Fatal("miss must not invent A2UI")
	}
	asked := Decide("s", Trigger{Kind: "glossary-term", Term: "box"}, DecideOpts{OperatorAskedAI: true})
	if asked.Reason != ReasonOperatorAsked || asked.Serve != SourceFrontier {
		t.Fatalf("operator ask: %+v", asked)
	}
}

func TestA2UIComponentsInCatalog(t *testing.T) {
	d := Decide(SurfaceKnowledge, Trigger{Kind: "route-opened", RouteID: "route.configure"}, DecideOpts{})
	if d.Reason != ReasonCatalogMatch {
		t.Fatalf("configure route should hit catalog: %+v", d)
	}
	for _, m := range d.Messages {
		if m.Version != A2UIVersion {
			t.Fatalf("version %s", m.Version)
		}
		if m.Type == "updateComponents" {
			comps, _ := m.Payload["components"].([]map[string]any)
			for _, c := range comps {
				name, _ := c["component"].(string)
				if Refuse(name) {
					t.Fatalf("outside catalog: %s", name)
				}
			}
		}
	}
}

func TestConfigurePathTeaches(t *testing.T) {
	path := Path()
	if len(path) != 5 {
		t.Fatalf("configure path drifted: %d", len(path))
	}
	if path[0].GlossaryTerm != "box" || path[1].ActionID != "vaultix.make-box" {
		t.Fatalf("ladder order: %+v", path)
	}
	msgs := Show(1)
	raw, _ := json.Marshal(msgs)
	if !strings.Contains(string(raw), "vaultix.make-box") {
		t.Fatalf("make-box missing from configure A2UI: %s", raw)
	}
	if strings.Contains(string(raw), "secretValue") || strings.Contains(string(raw), "sk-") {
		t.Fatal("configure A2UI leaked a value")
	}
	for _, m := range msgs {
		if m.Type != "updateComponents" {
			continue
		}
		comps, _ := m.Payload["components"].([]map[string]any)
		for _, c := range comps {
			if Refuse(c["component"].(string)) {
				t.Fatalf("configure used unknown component %v", c["component"])
			}
		}
	}
}

func TestRouteConfigureHasDropAndDidYouKnow(t *testing.T) {
	// First match by id sort: did-you-know vs drop. Both must be in catalog.
	foundDrop, foundDYK := false, false
	for _, e := range Catalog() {
		for _, tr := range e.Triggers {
			if tr.Kind == "route-opened" && tr.RouteID == "route.configure" {
				if e.Kind == KindKnowledgeDrop {
					foundDrop = true
				}
				if e.Kind == KindDidYouKnow {
					foundDYK = true
				}
			}
		}
	}
	if !foundDrop || !foundDYK {
		t.Fatalf("configure route missing drop=%v dyk=%v", foundDrop, foundDYK)
	}
}
