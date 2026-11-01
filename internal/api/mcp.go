package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"shippin.cloud/vaultix/internal/transport"
)

// MCP is a one-request adapter for callers that do not retain connection state.
func (c *Client) MCP(ctx context.Context, message json.RawMessage) (json.RawMessage, error) {
	return (&MCPConnection{}).Call(ctx, c, message)
}

// MCPConnection owns only transport context, never credentials. Keep one per
// stdio connection while supplying the current authenticated client on each call.
// The server must authorize every request independently of its session ID.
type MCPConnection struct {
	mu              sync.Mutex
	base            string
	sessionID       string
	protocolVersion string
	needsInitialize bool
}

var errMCPReconnect = errors.New("Vaultix MCP connection expired or changed; reconnect Vaultix in your AI client")

func (m *MCPConnection) Call(ctx context.Context, c *Client, message json.RawMessage) (json.RawMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	base, err := transport.URL(c.Base)
	if err != nil || base.RawQuery != "" {
		return nil, errors.New("invalid Vaultix API URL")
	}
	if len(message) > 16*1024 || !json.Valid(message) {
		return nil, errors.New("invalid MCP request")
	}
	var request struct {
		Method string `json:"method"`
		ID     any    `json:"id"`
	}
	if json.Unmarshal(message, &request) != nil {
		return nil, errors.New("invalid MCP request")
	}
	initialize := request.Method == "initialize"
	if m.base != "" && m.base != c.Base {
		m.sessionID, m.protocolVersion, m.needsInitialize = "", "", true
	}
	if initialize {
		// A new handshake must not carry or inherit an old session, even if it fails.
		m.sessionID, m.protocolVersion, m.needsInitialize = "", "", true
	} else if m.needsInitialize {
		return nil, errMCPReconnect
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Base+"/api/v1/vaultix/mcp", bytes.NewReader(message))
	if err != nil {
		return nil, errors.New("invalid MCP endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if m.sessionID != "" {
		req.Header.Set("Mcp-Session-Id", m.sessionID)
	}
	if m.protocolVersion != "" {
		req.Header.Set("MCP-Protocol-Version", m.protocolVersion)
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	res, err := transport.Client(c.HTTP).Do(req)
	if err != nil {
		return nil, errors.New("Vaultix connection failed; check connectivity and server trust")
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusAccepted && !initialize {
		return nil, nil
	}
	if res.StatusCode != http.StatusOK {
		if res.StatusCode == http.StatusNotFound && m.sessionID != "" {
			m.sessionID, m.protocolVersion, m.needsInitialize = "", "", true
			return nil, errMCPReconnect
		}
		if res.StatusCode == http.StatusUnauthorized {
			return nil, errors.New("Vaultix sign-in is no longer valid; run vaultix login outside your AI client")
		}
		if res.StatusCode == http.StatusTooManyRequests {
			return nil, errors.New("Vaultix request limit reached; wait before trying again")
		}
		return nil, errors.New("Vaultix could not authorize or complete this MCP request")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
	if err != nil || len(data) > 8<<20 || !json.Valid(data) {
		return nil, errors.New("invalid Vaultix MCP response")
	}
	if initialize {
		var reply struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      any             `json:"id"`
			Error   json.RawMessage `json:"error"`
			Result  struct {
				ProtocolVersion string `json:"protocolVersion"`
			} `json:"result"`
		}
		if json.Unmarshal(data, &reply) != nil || reply.JSONRPC != "2.0" ||
			!sameMCPID(request.ID, reply.ID) || len(reply.Error) != 0 {
			return nil, errors.New("invalid Vaultix MCP initialization response")
		}
		if _, err := time.Parse("2006-01-02", reply.Result.ProtocolVersion); err != nil {
			return nil, errors.New("invalid Vaultix MCP protocol version")
		}
		headers := res.Header.Values("Mcp-Session-Id")
		if len(headers) > 1 || (len(headers) == 1 && !validMCPSessionID(headers[0])) {
			return nil, errors.New("invalid Vaultix MCP session identifier")
		}
		if len(headers) == 1 {
			m.sessionID = headers[0]
		}
		m.base, m.protocolVersion, m.needsInitialize = c.Base, reply.Result.ProtocolVersion, false
	}
	return json.RawMessage(data), nil
}

func validMCPSessionID(value string) bool {
	if len(value) == 0 || len(value) > 1024 {
		return false
	}
	for _, b := range []byte(value) {
		if b < 0x21 || b > 0x7e {
			return false
		}
	}
	return true
}

func sameMCPID(a, b any) bool {
	switch a.(type) {
	case string, float64:
		return a == b
	default:
		return false
	}
}
