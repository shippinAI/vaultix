package api

import (
	"context"
	"net/http"
	"net/url"
)

// Scope is one folder of one environment of one project (by id).
type Scope struct{ Project, Env, Path string }

func (s Scope) path() string {
	if s.Path == "" {
		return "/"
	}
	return s.Path
}

// Secret is one key with its server version.
type Secret struct {
	Key     string `json:"secretKey"`
	Value   string `json:"secretValue"`
	Version int    `json:"version"`
}

// List returns every secret (with values) in scope.
func (c *Client) List(ctx context.Context, s Scope) ([]Secret, error) {
	q := url.Values{"workspaceId": {s.Project}, "environment": {s.Env}, "secretPath": {s.path()}}
	var out struct {
		Secrets []Secret `json:"secrets"`
	}
	err := c.do(ctx, http.MethodGet, "/api/v3/secrets/raw?"+q.Encode(), nil, &out)
	return out.Secrets, err
}

// Put creates (create=true) or updates key and returns the new server version.
func (c *Client) Put(ctx context.Context, s Scope, key, value string, create bool) (int, error) {
	in := map[string]string{"workspaceId": s.Project, "environment": s.Env, "secretPath": s.path(), "secretValue": value, "type": "shared"}
	method := http.MethodPatch
	if create {
		method = http.MethodPost
	}
	var out struct {
		Secret Secret `json:"secret"`
	}
	err := c.do(ctx, method, "/api/v3/secrets/raw/"+url.PathEscape(key), in, &out)
	return out.Secret.Version, err
}

// Delete removes key from scope.
func (c *Client) Delete(ctx context.Context, s Scope, key string) error {
	in := map[string]string{"workspaceId": s.Project, "environment": s.Env, "secretPath": s.path(), "type": "shared"}
	return c.do(ctx, http.MethodDelete, "/api/v3/secrets/raw/"+url.PathEscape(key), in, nil)
}
