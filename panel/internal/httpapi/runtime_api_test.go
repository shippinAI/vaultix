package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestCatalogAndViewport(t *testing.T) {
	f := newFixture(t)
	code, cat := f.call(t, "GET", "/api/v1/vaultix/catalog", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("catalog: %d %v", code, cat)
	}
	if cat["a2ui"] != "v0.9.1" {
		t.Fatalf("a2ui pin: %v", cat["a2ui"])
	}
	code, vp := f.call(t, "GET", "/api/v1/vaultix/viewport?route=route.configure", "jessay", "", nil)
	if code != http.StatusOK || vp["product"] != "vaultix" {
		t.Fatalf("viewport: %d %v", code, vp)
	}
	code, ans := f.call(t, "POST", "/api/v1/vaultix/runtime/answer", "jessay", "",
		map[string]string{"kind": "glossary-term", "term": "inject"})
	if code != http.StatusOK || ans["serve"] != "catalog" {
		t.Fatalf("answer: %d %v", code, ans)
	}
	raw, _ := json.Marshal(ans)
	if strings.Contains(string(raw), `"serve":"ml"`) {
		t.Fatal("ml valve")
	}
}

func TestConfigureA2UI(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "GET", "/api/v1/vaultix/configure?index=1", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("configure: %d %v", code, out)
	}
	raw, _ := json.Marshal(out)
	if !strings.Contains(string(raw), "vaultix.make-box") || !strings.Contains(string(raw), "v0.9.1") {
		t.Fatalf("%s", raw)
	}
}

func TestMCPCatalogTool(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "POST", "/api/v1/vaultix/mcp", "jessay", "", map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "tools/list",
	})
	if code != http.StatusOK {
		t.Fatalf("mcp list: %d %v", code, out)
	}
	code, call := f.call(t, "POST", "/api/v1/vaultix/mcp", "jessay", "", map[string]any{
		"jsonrpc": "2.0", "id": 2, "method": "tools/call",
		"params": map[string]any{
			"name": "vaultix.runtime.answer",
			"arguments": map[string]any{"kind": "route-opened", "routeId": "route.configure"},
		},
	})
	if code != http.StatusOK {
		t.Fatalf("mcp call: %d %v", code, call)
	}
	raw, _ := json.Marshal(call)
	if strings.Contains(strings.ToLower(string(raw)), "vaultix") {
		t.Fatal("mcp leftover brand")
	}
	if !strings.Contains(string(raw), "catalog") {
		t.Fatalf("expected catalog answer: %s", raw)
	}
}

func TestViewportPageServed(t *testing.T) {
	f := newFixture(t)
	req, _ := http.NewRequest("GET", f.ts.URL+"/viewport/", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("viewport page %d", res.StatusCode)
	}
	raw, _ := io.ReadAll(res.Body)
	page := string(raw)
	if !strings.Contains(page, "wordmark.svg") || !strings.Contains(page, "AngryVibes LLC") {
		t.Fatalf("viewport missing brand: %s", page[:min(400, len(page))])
	}
	icon, err := http.Get(f.ts.URL + "/favicon.svg")
	if err != nil {
		t.Fatal(err)
	}
	defer icon.Body.Close()
	if icon.StatusCode != http.StatusOK || icon.Header.Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("favicon %d %s", icon.StatusCode, icon.Header.Get("Content-Type"))
	}
}
