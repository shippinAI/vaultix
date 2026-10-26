package viewport

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestComposeConfigure(t *testing.T) {
	d := Compose("route.configure")
	if d.Product != "vaultix" || d.Stamp.Trusts != "nomen" || d.Stamp.Voice != "clyffy" {
		t.Fatalf("%+v", d)
	}
	if d.Next == nil || d.Next.Kind != "configure" {
		t.Fatal("configure route needs a next step")
	}
	if len(d.Configure) == 0 || len(d.Actions) == 0 {
		t.Fatal("viewport missing configure path or source actions")
	}
	raw, _ := json.Marshal(d)
	if strings.Contains(strings.ToLower(string(raw)), "infisical") {
		t.Fatal("viewport named leftover brand")
	}
	if strings.Contains(string(raw), `"value"`) && strings.Contains(string(raw), "sk-") {
		t.Fatal("viewport leaked a value")
	}
}

func TestUnknownRouteFallsToConfigure(t *testing.T) {
	d := Compose("route.nope")
	if d.RouteID != "route.configure" {
		t.Fatalf("route %s", d.RouteID)
	}
}
