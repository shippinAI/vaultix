package httpapi

import (
	"net/http"
	"testing"

	"shippin.cloud/vaultix/panel/internal/license"
	"shippin.cloud/vaultix/panel/internal/valves"
)

func TestCapabilitiesServedAllClosedByDefault(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "GET", "/api/v1/vaultix/capabilities", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("capabilities: %d %v", code, out)
	}
	if out["owner"] != license.Owner || out["tier"] != string(license.Community) {
		t.Fatalf("capabilities stamp: %v", out)
	}
	vs, ok := out["valves"].([]any)
	if !ok || len(vs) == 0 {
		t.Fatalf("expected valve list: %v", out)
	}
	for _, v := range vs {
		if v.(map[string]any)["enabled"] == true {
			t.Fatalf("valve open by default: %v", v)
		}
	}
}

func TestApprovalGateClosedAppliesImmediately(t *testing.T) {
	f := newFixture(t)
	tok := f.elevate(t, "jessay")
	code, box := f.call(t, "POST", "/api/v1/vaultix/projects", "jessay", tok, map[string]string{"name": "app"})
	if code != http.StatusCreated {
		t.Fatalf("box: %d %v", code, box)
	}
	id := box["projectId"].(string)
	code, out := f.call(t, "PUT", "/api/v1/vaultix/projects/"+id+"/secrets/API_KEY", "jessay", tok,
		map[string]string{"environment": "dev", "value": "v"})
	if code != http.StatusOK {
		t.Fatalf("closed gate must apply immediately: %d %v", code, out)
	}
}

func TestApprovalGateOpenHoldsWrite(t *testing.T) {
	f := newFixture(t)
	f.srv.License = license.Load("enterprise", "", "")
	f.srv.Valves.ApprovalGate = valves.ApprovalGate{Enabled: true}
	tok := f.elevate(t, "jessay")
	code, box := f.call(t, "POST", "/api/v1/vaultix/projects", "jessay", tok, map[string]string{"name": "app"})
	if code != http.StatusCreated {
		t.Fatalf("box: %d %v", code, box)
	}
	id := box["projectId"].(string)
	code, out := f.call(t, "PUT", "/api/v1/vaultix/projects/"+id+"/secrets/API_KEY", "jessay", tok,
		map[string]string{"environment": "dev", "value": "v"})
	if code != http.StatusAccepted || out["held"] != true {
		t.Fatalf("open gate must hold the write: %d %v", code, out)
	}
	if _, err := f.engine.Reveal(t.Context(), id, "dev", "API_KEY"); err == nil {
		t.Fatal("held write should not have applied")
	}
}

func TestAccessPolicyOpenDeniesPath(t *testing.T) {
	f := newFixture(t)
	f.srv.License = license.Load("enterprise", "", "")
	f.srv.Valves.AccessPolicy = valves.AccessPolicy{Enabled: true, Deny: []string{"/prod"}}
	tok := f.elevate(t, "jessay")
	code, box := f.call(t, "POST", "/api/v1/vaultix/projects", "jessay", tok, map[string]string{"name": "app"})
	if code != http.StatusCreated {
		t.Fatalf("box: %d %v", code, box)
	}
	id := box["projectId"].(string)
	code, _ = f.call(t, "PUT", "/api/v1/vaultix/projects/"+id+"/secrets/K", "jessay", tok,
		map[string]string{"environment": "prod", "value": "v", "path": "/prod"})
	if code != http.StatusForbidden {
		t.Fatalf("denied path must 403, got %d", code)
	}
}

func TestRateCapOpenGates(t *testing.T) {
	f := newFixture(t)
	f.srv.License = license.Load("membership", "", "member-1")
	f.srv.RateCap = valves.NewRateCap(true, 1)
	tok := f.elevate(t, "jessay")
	id := f.seed(t, "jessay", "app", "dev", "K", "v")
	c1, _ := f.call(t, "POST", "/api/v1/vaultix/inject", "jessay", tok,
		map[string]string{"projectId": id, "environment": "dev", "name": "K"})
	if c1 != http.StatusCreated {
		t.Fatalf("first action should pass: %d", c1)
	}
	c2, _ := f.call(t, "POST", "/api/v1/vaultix/inject", "jessay", tok,
		map[string]string{"projectId": id, "environment": "dev", "name": "K"})
	if c2 != http.StatusTooManyRequests {
		t.Fatalf("second action should be capped, got %d", c2)
	}
}
