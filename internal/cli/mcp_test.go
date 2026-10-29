package cli

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestMCPProtocolOnlyOutput(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n"
	var out strings.Builder
	calls := 0
	err := serveMCP(context.Background(), strings.NewReader(input), &out, func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		calls++
		if calls == 1 {
			return nil, nil
		}
		return json.RawMessage(`{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}`), nil
	})
	if err != nil || calls != 2 || strings.Count(out.String(), "\n") != 1 || !json.Valid([]byte(strings.TrimSpace(out.String()))) {
		t.Fatal("stdio framing failed")
	}
}

func TestMCPFailuresKeepRequestIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		err            error
		code           int
	}{
		{"denied", "", errors.New("sign in again"), -32001},
		{"wrong-id", `{"jsonrpc":"2.0","id":99,"result":{}}`, nil, -32603},
		{"no-response", "", nil, -32603},
		{"ambiguous", `{"jsonrpc":"2.0","id":1,"result":{},"error":{}}`, nil, -32603},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out strings.Builder
			err := serveMCP(context.Background(), strings.NewReader("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n"), &out, func(context.Context, json.RawMessage) (json.RawMessage, error) {
				return json.RawMessage(tc.response), tc.err
			})
			var got struct {
				ID    int `json:"id"`
				Error struct {
					Code int `json:"code"`
				} `json:"error"`
			}
			if err != nil || json.Unmarshal([]byte(out.String()), &got) != nil || got.ID != 1 || got.Error.Code != tc.code {
				t.Fatal("wrong failure envelope")
			}
		})
	}
}

func TestMCPRejectsOversizedInput(t *testing.T) {
	err := serveMCP(context.Background(), strings.NewReader(strings.Repeat("x", 17000)), &strings.Builder{}, func(context.Context, json.RawMessage) (json.RawMessage, error) {
		t.Fatal("oversized request forwarded")
		return nil, nil
	})
	if err == nil {
		t.Fatal("oversized line accepted")
	}
}

func TestMCPConfigDoesNotContainCredential(t *testing.T) {
	t.Setenv("VAULTIX_TOKEN", "private-config-canary")
	t.Setenv("VAULTIX_HOME", t.TempDir())
	var out strings.Builder
	if err := MCPConfig(&out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "[mcp_servers.vaultix]") || strings.Contains(out.String(), "private-config-canary") {
		t.Fatal("invalid or sensitive config")
	}
}

func TestMCPInvalidIDsNeverReachServer(t *testing.T) {
	for _, id := range []string{"null", "true", "{}", "[]", "1.5", "9007199254740992", `"` + strings.Repeat("x", 129) + `"`} {
		t.Run(id, func(t *testing.T) {
			var out strings.Builder
			input := `{"jsonrpc":"2.0","id":` + id + `,"method":"tools/list"}` + "\n"
			err := serveMCP(context.Background(), strings.NewReader(input), &out, func(context.Context, json.RawMessage) (json.RawMessage, error) {
				t.Fatal("invalid ID forwarded")
				return nil, nil
			})
			var reply struct {
				ID    any `json:"id"`
				Error struct {
					Code int `json:"code"`
				} `json:"error"`
			}
			if err != nil || json.Unmarshal([]byte(out.String()), &reply) != nil || reply.ID != nil || reply.Error.Code != -32600 {
				t.Fatal("invalid ID did not produce a valid null-ID error")
			}
		})
	}
}

func TestMCPNumericallyEquivalentIDs(t *testing.T) {
	var out strings.Builder
	err := serveMCP(context.Background(), strings.NewReader("{\"jsonrpc\":\"2.0\",\"id\":1.0,\"method\":\"ping\"}\n"), &out, func(context.Context, json.RawMessage) (json.RawMessage, error) {
		return json.RawMessage(`{"jsonrpc":"2.0","id":1,"result":{}}`), nil
	})
	if err != nil || strings.Contains(out.String(), "error") {
		t.Fatal("equivalent response ID rejected")
	}
}

func TestMCPUnicodeIDMatchesCoreLength(t *testing.T) {
	id, _ := json.Marshal(strings.Repeat("é", 128))
	if _, valid := mcpID(id); !valid {
		t.Fatal("valid Unicode ID rejected by byte length")
	}
}
