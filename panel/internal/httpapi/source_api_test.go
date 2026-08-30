package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestSourceManifestServed(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "GET", "/api/v1/vaultix/source/manifest", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("manifest: %d %v", code, out)
	}
	if out["boundary"] != "vaultix" {
		t.Fatalf("wrong boundary: %v", out["boundary"])
	}
	actions, ok := out["actions"].([]any)
	if !ok || len(actions) == 0 {
		t.Fatalf("no actions in manifest: %v", out)
	}
	// Manifest is plain-language labels + narration; never a secret.
	raw, _ := json.Marshal(out)
	if !strings.Contains(string(raw), "Make a box") {
		t.Fatalf("expected plain-language labels: %s", raw)
	}
}

func TestSourceManifestNeedsIdentity(t *testing.T) {
	f := newFixture(t)
	code, _ := f.call(t, "GET", "/api/v1/vaultix/source/manifest", "", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", code)
	}
}

func TestSourceActRequiresStepUp(t *testing.T) {
	f := newFixture(t)
	code, _ := f.call(t, "POST", "/api/v1/vaultix/source/act", "jessay", "",
		map[string]any{"actionId": "vaultix.make-box", "inputs": map[string]string{"name": "app"}})
	if code != http.StatusForbidden {
		t.Fatalf("want 403 without step-up, got %d", code)
	}
}

func TestSourceActMakeBoxObservable(t *testing.T) {
	f := newFixture(t)
	tok := f.elevate(t, "jessay")
	code, out := f.call(t, "POST", "/api/v1/vaultix/source/act", "jessay", tok, map[string]any{
		"actionId": "vaultix.make-box", "actor": "clyffy",
		"inputs": map[string]string{"name": "myapp"},
	})
	if code != http.StatusOK {
		t.Fatalf("act: %d %v", code, out)
	}
	res := out["result"].(map[string]any)
	if res["outcome"] != "ok" {
		t.Fatalf("expected ok outcome: %v", res)
	}
	if res["actor"] != "clyffy" {
		t.Fatalf("actor not recorded: %v", res["actor"])
	}
	steps := res["steps"].([]any)
	if len(steps) < 2 {
		t.Fatalf("expected observable steps, got %v", steps)
	}
}

func TestSourceActStoreKeyNeverEchoesValue(t *testing.T) {
	f := newFixture(t)
	tok := f.elevate(t, "jessay")
	// make a box, then store a key through the source API
	code, made := f.call(t, "POST", "/api/v1/vaultix/source/act", "jessay", tok, map[string]any{
		"actionId": "vaultix.make-box", "inputs": map[string]string{"name": "app"},
	})
	if code != http.StatusOK {
		t.Fatalf("make-box: %d %v", code, made)
	}
	pid := made["result"].(map[string]any)["meta"].(map[string]any)["projectId"].(string)
	code, out := f.call(t, "POST", "/api/v1/vaultix/source/act", "jessay", tok, map[string]any{
		"actionId": "vaultix.store-key",
		"inputs": map[string]string{
			"projectId": pid, "environment": "dev",
			"name": "API_KEY", "value": "sk-topsecret",
		},
	})
	if code != http.StatusOK {
		t.Fatalf("store-key: %d %v", code, out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "sk-topsecret") {
		t.Fatal("source API echoed the secret value")
	}
}
