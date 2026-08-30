package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"shippin.cloud/vaultix/panel/internal/source"
)

type fakeOps struct{}

func (fakeOps) CreateProject(_ context.Context, name string) (string, error) {
	return "box-" + name, nil
}
func (fakeOps) PutSecret(context.Context, string, string, string, string) error { return nil }
func (fakeOps) Inject(context.Context, string, string, string, string) (string, time.Time, error) {
	return "handle-1", time.Now().Add(time.Minute), nil
}

func rpc(t *testing.T, s *Server, method string, params any) map[string]any {
	t.Helper()
	body := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		body["params"] = params
	}
	raw, _ := json.Marshal(body)
	res := s.Handle(context.Background(), raw)
	out, _ := json.Marshal(res)
	var m map[string]any
	json.Unmarshal(out, &m)
	return m
}

func TestInitializeAndList(t *testing.T) {
	s := &Server{}
	init := rpc(t, s, "initialize", nil)
	result := init["result"].(map[string]any)
	if result["protocolVersion"] != ProtocolVersion {
		t.Fatalf("%v", result)
	}
	info := result["serverInfo"].(map[string]any)
	if info["name"] != "vaultix" {
		t.Fatalf("server %v", info)
	}
	listed := rpc(t, s, "tools/list", nil)
	tools := listed["result"].(map[string]any)["tools"].([]any)
	if len(tools) != 5 {
		t.Fatalf("tools %d", len(tools))
	}
	raw, _ := json.Marshal(listed)
	if strings.Contains(strings.ToLower(string(raw)), "infisical") {
		t.Fatal("MCP listed leftover brand")
	}
}

func TestCatalogAnswerNotFrontierForBox(t *testing.T) {
	s := &Server{}
	res := rpc(t, s, "tools/call", map[string]any{
		"name": "vaultix.runtime.answer",
		"arguments": map[string]any{"kind": "glossary-term", "term": "box"},
	})
	text := res["result"].(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, `"serve":"catalog"`) {
		t.Fatalf("expected catalog: %s", text)
	}
	if strings.Contains(text, `"serve":"ml"`) {
		t.Fatal("ml valve opened over MCP")
	}
}

func TestActNeverEchoesValue(t *testing.T) {
	s := &Server{Ops: fakeOps{}, User: "jessay"}
	res := rpc(t, s, "tools/call", map[string]any{
		"name": "vaultix.source.act",
		"arguments": map[string]any{
			"actionId": "vaultix.store-key", "actor": "clyffy",
			"inputs": map[string]any{
				"projectId": "b1", "environment": "dev",
				"name": "API_KEY", "value": "sk-super-secret",
			},
		},
	})
	raw, _ := json.Marshal(res)
	if strings.Contains(string(raw), "sk-super-secret") {
		t.Fatal("MCP echoed a secret value")
	}
}

func TestConfigureShowIsA2UI(t *testing.T) {
	s := &Server{}
	res := rpc(t, s, "tools/call", map[string]any{
		"name": "vaultix.configure.show", "arguments": map[string]any{"index": 0},
	})
	text := res["result"].(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "what-a-box-is") || !strings.Contains(text, "v0.9.1") {
		t.Fatalf("configure show: %s", text)
	}
}

var _ source.Ops = fakeOps{}
