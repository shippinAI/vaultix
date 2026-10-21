package httpapi

import (
	"net/http"
	"testing"
)

func TestUsageServedAndUnenforcedByDefault(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "GET", "/api/v1/vaultix/usage", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("usage: %d %v", code, out)
	}
	if out["enforced"] != false {
		t.Fatalf("metering must default to unenforced, got %v", out["enforced"])
	}
	features, ok := out["features"].([]any)
	if !ok || len(features) == 0 {
		t.Fatalf("meter view must list features: %v", out)
	}
}

func TestUsageNeedsIdentity(t *testing.T) {
	f := newFixture(t)
	code, _ := f.call(t, "GET", "/api/v1/vaultix/usage", "", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", code)
	}
}
