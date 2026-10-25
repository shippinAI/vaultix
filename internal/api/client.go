// Package api talks to the Vaultix (vaultix-compatible) HTTP API. Tokens are held in memory
// only and are never logged.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client is an authenticated API client.
type Client struct {
	Base  string
	Token string
	HTTP  *http.Client
}

// New returns a client for base (e.g. https://secrets.shippin.cloud).
func New(base, token string) *Client {
	return &Client{Base: strings.TrimRight(base, "/"), Token: token, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

// Error is a non-2xx API answer.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("vaultix: HTTP %d: %s", e.Status, e.Message) }

// NotFound reports whether err is an HTTP 404.
func NotFound(err error) bool {
	e, ok := err.(*Error)
	return ok && e.Status == http.StatusNotFound
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode/100 != 2 {
		var m struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &m)
		return &Error{Status: res.StatusCode, Message: m.Message}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(data, out)
}

// UniversalLogin exchanges a machine identity's client id/secret for an access token.
func UniversalLogin(ctx context.Context, base, clientID, clientSecret string) (string, time.Duration, error) {
	var out struct {
		AccessToken string `json:"accessToken"`
		ExpiresIn   int    `json:"expiresIn"`
	}
	err := New(base, "").do(ctx, http.MethodPost, "/api/v1/auth/universal-auth/login",
		map[string]string{"clientId": clientID, "clientSecret": clientSecret}, &out)
	return out.AccessToken, time.Duration(out.ExpiresIn) * time.Second, err
}

// ProjectID resolves a project slug to its immutable id.
func (c *Client) ProjectID(ctx context.Context, slug string) (string, error) {
	var out struct {
		ID string `json:"id"`
	}
	err := c.do(ctx, http.MethodGet, "/api/v2/workspace/"+url.PathEscape(slug), nil, &out)
	return out.ID, err
}

// Status is the unauthenticated health endpoint.
func (c *Client) Status(ctx context.Context) error {
	return c.do(ctx, http.MethodGet, "/api/status", nil, nil)
}
