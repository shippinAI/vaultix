package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const mcpInitialize = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"fixture","version":"1"},"capabilities":{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}}}`
const mcpInitialized = `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}}`
const mcpList = `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`

func TestMCPConnectionFreshCredentialsAndIsolation(t *testing.T) {
	var seen []http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Clone())
		var request struct{ Method string }
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid request")
		}
		if request.Method == "initialize" {
			w.Header().Set("Mcp-Session-Id", "fixture-session-context")
			fmt.Fprint(w, mcpInitialized)
			return
		}
		// Ordinary responses cannot rotate context after the handshake.
		w.Header().Set("Mcp-Session-Id", "unrequested-session-replacement")
		fmt.Fprint(w, `{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}`)
	}))
	defer server.Close()
	connection := &MCPConnection{}
	for i, message := range []string{mcpInitialize, mcpList, mcpList} {
		client := New(server.URL, fmt.Sprintf("fixture-token-%d", i))
		if _, err := connection.Call(context.Background(), client, json.RawMessage(message)); err != nil {
			t.Fatal(err)
		}
	}
	if seen[0].Get("Mcp-Session-Id") != "" || seen[0].Get("MCP-Protocol-Version") != "" {
		t.Fatal("initialization carried old context")
	}
	for i := 1; i < 3; i++ {
		if seen[i].Get("Mcp-Session-Id") != "fixture-session-context" || seen[i].Get("MCP-Protocol-Version") != "2025-06-18" || seen[i].Get("Authorization") != fmt.Sprintf("Bearer fixture-token-%d", i) {
			t.Fatal("connection did not preserve context with fresh authorization")
		}
	}
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("old connection reached another instance")
	}))
	defer other.Close()
	if _, err := connection.Call(context.Background(), New(other.URL, "other-fixture"), json.RawMessage(mcpList)); err != errMCPReconnect {
		t.Fatal("instance change did not require initialization")
	}
	if _, err := (&MCPConnection{}).Call(context.Background(), New(server.URL, "independent"), json.RawMessage(mcpList)); err != nil {
		t.Fatal(err)
	}
	if seen[3].Get("Mcp-Session-Id") != "" || seen[3].Get("MCP-Protocol-Version") != "" {
		t.Fatal("another connection inherited context")
	}
}

func TestMCPExpiredSessionRequiresFreshHandshakeWithoutReplay(t *testing.T) {
	calls, initializations := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request struct{ Method string }
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.Method == "initialize" {
			initializations++
			if r.Header.Get("Mcp-Session-Id") != "" {
				t.Error("reinitialization sent an expired identifier")
			}
			w.Header().Set("Mcp-Session-Id", fmt.Sprintf("fixture-session-%d", initializations))
			fmt.Fprint(w, mcpInitialized)
		} else if initializations == 1 {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, "private-error-canary")
		} else {
			if r.Header.Get("Mcp-Session-Id") != "fixture-session-2" {
				t.Error("fresh session not used")
			}
			fmt.Fprint(w, `{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}`)
		}
	}))
	defer server.Close()
	connection, client := &MCPConnection{}, New(server.URL, "fixture")
	if _, err := connection.Call(context.Background(), client, json.RawMessage(mcpInitialize)); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := connection.Call(context.Background(), client, json.RawMessage(mcpList)); err != errMCPReconnect {
			t.Fatal("expired session did not require reconnect")
		}
	}
	if calls != 2 {
		t.Fatal("expired action replayed or later request forwarded")
	}
	for _, message := range []string{mcpInitialize, mcpList} {
		if _, err := connection.Call(context.Background(), client, json.RawMessage(message)); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 4 {
		t.Fatal("handshake recovery did not complete")
	}
}

func TestMCPRejectsPoisonedInitialization(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		headers    []string
		status     int
	}{
		{"duplicate-header", mcpInitialized, []string{"first", "second"}, 200},
		{"empty-header", mcpInitialized, []string{""}, 200},
		{"whitespace-header", mcpInitialized, []string{"has space"}, 200},
		{"unicode-header", mcpInitialized, []string{"caf\u00e9"}, 200},
		{"oversized-header", mcpInitialized, []string{strings.Repeat("x", 1025)}, 200},
		{"wrong-id", strings.Replace(mcpInitialized, `"id":1`, `"id":9`, 1), []string{"fixture"}, 200},
		{"wrong-jsonrpc", strings.Replace(mcpInitialized, `"2.0"`, `"1.0"`, 1), []string{"fixture"}, 200},
		{"missing-version", `{"jsonrpc":"2.0","id":1,"result":{}}`, []string{"fixture"}, 200},
		{"bad-version", strings.Replace(mcpInitialized, "2025-06-18", "private-error-canary", 1), []string{"fixture"}, 200},
		{"invalid-date", strings.Replace(mcpInitialized, "2025-06-18", "2025-99-99", 1), []string{"fixture"}, 200},
		{"error-and-result", strings.Replace(mcpInitialized, `"result":`, `"error":{},"result":`, 1), []string{"fixture"}, 200},
		{"notification-response", "", []string{"fixture"}, 202},
		{"redirect", "private-error-canary", []string{"fixture"}, 307},
		{"oversized-body", `{"padding":"` + strings.Repeat("x", 8<<20) + `"}`, []string{"fixture"}, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Mcp-Session-Id") != "" || r.Header.Get("MCP-Protocol-Version") != "" {
					t.Error("replacement initialization inherited old context")
				}
				if calls == 1 {
					w.Header().Set("Mcp-Session-Id", "previous-valid-session")
					fmt.Fprint(w, mcpInitialized)
					return
				}
				for _, header := range tc.headers {
					w.Header().Add("Mcp-Session-Id", header)
				}
				w.Header().Set("Location", "/must-not-follow")
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			connection, client := &MCPConnection{}, New(server.URL, "private-credential-canary")
			if _, err := connection.Call(context.Background(), client, json.RawMessage(mcpInitialize)); err != nil {
				t.Fatal(err)
			}
			_, err := connection.Call(context.Background(), client, json.RawMessage(mcpInitialize))
			if err == nil || strings.Contains(err.Error(), "canary") {
				t.Fatal("invalid initialization accepted or reflected")
			}
			if _, err := connection.Call(context.Background(), client, json.RawMessage(mcpList)); err != errMCPReconnect || calls != 2 {
				t.Fatal("failed handshake retained usable context or retried")
			}
		})
	}
}

func TestMCPStatelessCompatibility(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Mcp-Session-Id") != "" {
			t.Error("invented session identifier")
		}
		var request struct{ Method string }
		_ = json.NewDecoder(r.Body).Decode(&request)
		switch request.Method {
		case "initialize":
			fmt.Fprint(w, mcpInitialized)
		case "notifications/initialized":
			if r.Header.Get("MCP-Protocol-Version") != "2025-06-18" {
				t.Error("notification omitted negotiated version")
			}
			w.WriteHeader(http.StatusAccepted)
		default:
			fmt.Fprint(w, `{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}`)
		}
	}))
	defer server.Close()
	connection, client := &MCPConnection{}, New(server.URL, "fixture")
	for _, message := range []string{mcpList, mcpInitialize, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, mcpList} {
		if _, err := connection.Call(context.Background(), client, json.RawMessage(message)); err != nil {
			t.Fatal(err)
		}
	}
}
