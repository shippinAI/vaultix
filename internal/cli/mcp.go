package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// MCP serves newline-delimited stdio using the same core catalog as HTTP.
// Login happens in a separate human terminal; stdout is protocol-only.
func MCP(ctx context.Context, stdin io.Reader, out io.Writer) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	session := &clientSession{cfg: cfg}
	c, err := session.client(ctx)
	if err != nil {
		return err
	}
	if err := c.VerifyAccess(ctx); err != nil {
		return err
	}
	return serveMCP(ctx, stdin, out, func(ctx context.Context, message json.RawMessage) (json.RawMessage, error) {
		// Reread per request: logout, expiry and replacement credentials take
		// effect without keeping an old token alive in a long-lived AI process.
		client, err := session.client(ctx)
		if err != nil {
			return nil, errors.New("Vaultix sign-in unavailable; run vaultix login outside your AI client")
		}
		return client.MCP(ctx, message)
	})
}

type mcpCall func(context.Context, json.RawMessage) (json.RawMessage, error)

// IDs use the same bounded string/safe-integer contract as the core endpoint.
// Decode numbers before comparison so equivalent JSON spellings still match.
func mcpID(raw json.RawMessage) (any, bool) {
	var id any
	if json.Unmarshal(raw, &id) != nil {
		return nil, false
	}
	switch value := id.(type) {
	case string:
		return value, len(utf16.Encode([]rune(value))) <= 128
	case float64:
		return value, math.Trunc(value) == value && math.Abs(value) <= 9007199254740991
	default:
		return nil, false
	}
}

func serveMCP(ctx context.Context, stdin io.Reader, out io.Writer, call mcpCall) error {
	scanner := bufio.NewScanner(stdin)
	scanner.Buffer(make([]byte, 4096), 16*1024+1)
	encoder := json.NewEncoder(out)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		line := scanner.Bytes()
		var request struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Method  string          `json:"method"`
		}
		if len(line) > 16*1024 || !utf8.Valid(line) || json.Unmarshal(line, &request) != nil || request.JSONRPC != "2.0" || request.Method == "" || len(request.Method) > 128 {
			if err := encoder.Encode(rpcError(nil, -32600, "Invalid MCP request.")); err != nil {
				return err
			}
			continue
		}
		requestID, validID := mcpID(request.ID)
		if (len(request.ID) > 0 && !validID) || (len(request.ID) == 0 && !strings.HasPrefix(request.Method, "notifications/")) {
			if err := encoder.Encode(rpcError(nil, -32600, "Invalid MCP request ID.")); err != nil {
				return err
			}
			continue
		}
		response, err := call(ctx, append(json.RawMessage(nil), line...))
		if len(request.ID) == 0 {
			continue
		}
		if err != nil {
			// Only fixed local transport messages reach the client, never an
			// upstream error body, credential, URL query or network error.
			if err := encoder.Encode(rpcError(request.ID, -32001, err.Error())); err != nil {
				return err
			}
			continue
		}
		var reply struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Result  json.RawMessage `json:"result"`
			Error   json.RawMessage `json:"error"`
		}
		decodeError := json.Unmarshal(response, &reply)
		replyID, validReplyID := mcpID(reply.ID)
		if decodeError != nil || !utf8.Valid(response) || reply.JSONRPC != "2.0" || !validReplyID || replyID != requestID || (len(reply.Result) == 0) == (len(reply.Error) == 0) {
			if err := encoder.Encode(rpcError(request.ID, -32603, "Invalid Vaultix MCP response.")); err != nil {
				return err
			}
			continue
		}
		if err := encoder.Encode(response); err != nil {
			return err
		}
	}
	if scanner.Err() != nil {
		return errors.New("MCP input failed or exceeded the 16 KiB request limit")
	}
	return nil
}

func rpcError(id json.RawMessage, code int, message string) any {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	return struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Error   any             `json:"error"`
	}{"2.0", id, struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}{code, message}}
}

// MCPConfig prints only a configuration fragment. It never edits the user's
// provider/model settings, reads Codex credentials, or embeds Vaultix tokens.
func MCPConfig(out io.Writer) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	home, err := filepath.Abs(Dir())
	if err != nil {
		return err
	}
	// JSON quoted strings are also valid TOML basic strings for these paths.
	quote := func(s string) string { b, _ := json.Marshal(s); return string(b) }
	_, err = fmt.Fprintf(out, "[mcp_servers.vaultix]\ncommand = %s\nargs = [\"mcp\"]\n\n[mcp_servers.vaultix.env]\nVAULTIX_HOME = %s\n", quote(executable), quote(home))
	return err
}
