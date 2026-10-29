package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"shippin.cloud/vaultix/internal/transport"
)

// MCP connects only to this instance's stateless, metadata-only core catalog.
// It is a transport adapter; authorization and domain actions remain server-side.
func (c *Client) MCP(ctx context.Context, message json.RawMessage) (json.RawMessage, error) {
	base, err := transport.URL(c.Base)
	if err != nil || base.RawQuery != "" {
		return nil, errors.New("invalid Vaultix API URL")
	}
	if len(message) > 16*1024 || !json.Valid(message) {
		return nil, errors.New("invalid MCP request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Base+"/api/v1/vaultix/mcp", bytes.NewReader(message))
	if err != nil {
		return nil, errors.New("invalid MCP endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	res, err := transport.Client(c.HTTP).Do(req)
	if err != nil {
		return nil, errors.New("Vaultix connection failed; check connectivity and server trust")
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusAccepted {
		return nil, nil
	}
	if res.StatusCode != http.StatusOK {
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
	return json.RawMessage(data), nil
}
