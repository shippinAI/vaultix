// Package core talks to the owned secrets engine in this tree (core/).
// Secrets live there. panel/internal/vault is overlay/test fallback only.
// Wire paths live in wire.go.
package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// ErrApprovalRequired: the core accepted the write into an approval flow
// instead of applying it (secret protection policy). HTTP 200, union
// response with an "approval" key — the secret was NOT written.
var ErrApprovalRequired = errors.New("core: write held for approval; not applied")

type Client struct {
	BaseURL string
	http    *http.Client

	mu           sync.Mutex
	clientID     string
	clientSecret string
	token        string
	tokenExpiry  time.Time
	now          func() time.Time // test hook
}

func New(baseURL string) *Client {
	return &Client{BaseURL: baseURL, http: &http.Client{Timeout: 60 * time.Second}, now: time.Now}
}

// Login exchanges a machine-identity client id/secret for an access token.
// The credential is retained so long runs can re-login before expiry
// (expiresIn is the token TTL in seconds; renewal is capped by
// accessTokenMaxTTL upstream — a fresh login avoids that ceiling).
func (c *Client) Login(ctx context.Context, clientID, clientSecret string) error {
	c.mu.Lock()
	c.clientID, c.clientSecret = clientID, clientSecret
	c.mu.Unlock()
	return c.login(ctx)
}

func (c *Client) login(ctx context.Context) error {
	c.mu.Lock()
	body := map[string]string{"clientId": c.clientID, "clientSecret": c.clientSecret}
	c.mu.Unlock()
	var out struct {
		AccessToken string `json:"accessToken"`
		ExpiresIn   int64  `json:"expiresIn"`
	}
	if err := c.do(ctx, http.MethodPost, wireLoginPath, body, &out, false); err != nil {
		return fmt.Errorf("core login: %w", err)
	}
	if out.AccessToken == "" {
		return errors.New("core login: empty access token")
	}
	c.mu.Lock()
	c.token = out.AccessToken
	c.tokenExpiry = c.now().Add(time.Duration(out.ExpiresIn) * time.Second)
	c.mu.Unlock()
	return nil
}

// ensureToken re-logins when the token is missing or within a minute of
// expiry. Upstream lockout defaults (3 failed logins -> 5 min lock) make
// blind retry loops dangerous; one re-login per need, errors propagate.
func (c *Client) ensureToken(ctx context.Context) error {
	c.mu.Lock()
	ok := c.token != "" && c.now().Add(time.Minute).Before(c.tokenExpiry)
	c.mu.Unlock()
	if ok {
		return nil
	}
	return c.login(ctx)
}

type Project struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Environments []Environment `json:"environments"`
}

type Environment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// GetProject fetches a project and its environments.
// GET /api/v1/projects/{projectId} -> { project?: {...} } — the envelope
// key is optional in the upstream schema, so absence is an error here.
func (c *Client) GetProject(ctx context.Context, id string) (Project, error) {
	if err := c.ensureToken(ctx); err != nil {
		return Project{}, err
	}
	var out struct {
		Project *Project `json:"project"`
	}
	if err := c.do(ctx, http.MethodGet, wireProjectsPath+"/"+url.PathEscape(id), nil, &out, true); err != nil {
		return Project{}, err
	}
	if out.Project == nil {
		return Project{}, fmt.Errorf("core: project %s not found", id)
	}
	return *out.Project, nil
}

// CreateProject creates a project. The org is derived from the identity's
// token upstream; there is no organization field in the request.
// POST /api/v1/projects { projectName } -> { project: {...} }
func (c *Client) CreateProject(ctx context.Context, name string) (string, error) {
	if err := c.ensureToken(ctx); err != nil {
		return "", err
	}
	var out struct {
		Project Project `json:"project"`
	}
	if err := c.do(ctx, http.MethodPost, wireProjectsPath, map[string]string{"projectName": name}, &out, true); err != nil {
		return "", err
	}
	return out.Project.ID, nil
}

type Secret struct {
	Key    string `json:"secretKey"`
	Value  string `json:"secretValue"`
	Path   string `json:"secretPath,omitempty"`
	Hidden bool   `json:"secretValueHidden"`
}

// ListSecrets pulls all secrets for one environment, recursively. No
// pagination exists upstream — the response is the full tree. Callers must
// check Secret.Hidden: hidden values are placeholders the identity is not
// permitted to read, never real values.
// GET /api/v4/secrets?projectId=&environment=&secretPath=/&recursive=true
func (c *Client) ListSecrets(ctx context.Context, projectID, envSlug string) ([]Secret, error) {
	if err := c.ensureToken(ctx); err != nil {
		return nil, err
	}
	q := url.Values{
		"projectId":   {projectID},
		"environment": {envSlug},
		"secretPath":  {"/"},
		// Boolean params are string enums upstream ("true"/"false").
		"recursive":              {"true"},
		"includeImports":         {"false"},
		"expandSecretReferences": {"false"},
		"viewSecretValue":        {"true"},
	}
	var out struct {
		Secrets []Secret `json:"secrets"`
	}
	err := c.do(ctx, http.MethodGet, wireSecretsPath+"?"+q.Encode(), nil, &out, true)
	return out.Secrets, err
}

type batchItem struct {
	SecretKey   string `json:"secretKey"`
	SecretValue string `json:"secretValue"`
}

// BatchCreate creates many secrets under one (project, env, path) in a
// single call. POST /api/v4/secrets/batch. The 200 response is a union:
// {secrets:[...]} applied, or {approval:{...}} held — the latter returns
// ErrApprovalRequired and nothing was written.
func (c *Client) BatchCreate(ctx context.Context, projectID, envSlug, path string, secrets []Secret) error {
	return c.batch(ctx, http.MethodPost, projectID, envSlug, path, secrets)
}

// BatchUpdate updates many secrets under one (project, env, path).
// PATCH /api/v4/secrets/batch. Same union response as BatchCreate.
func (c *Client) BatchUpdate(ctx context.Context, projectID, envSlug, path string, secrets []Secret) error {
	return c.batch(ctx, http.MethodPatch, projectID, envSlug, path, secrets)
}

func (c *Client) batch(ctx context.Context, method, projectID, envSlug, path string, secrets []Secret) error {
	if len(secrets) == 0 {
		return nil
	}
	if err := c.ensureToken(ctx); err != nil {
		return err
	}
	if path == "" {
		path = "/"
	}
	items := make([]batchItem, len(secrets))
	for i, s := range secrets {
		items[i] = batchItem{SecretKey: s.Key, SecretValue: s.Value}
	}
	body := map[string]any{
		"projectId":   projectID,
		"environment": envSlug,
		"secretPath":  path,
		"secrets":     items,
	}
	var out map[string]json.RawMessage
	if err := c.do(ctx, method, wireSecretsBatchPath, body, &out, true); err != nil {
		return err
	}
	if _, held := out["approval"]; held {
		return ErrApprovalRequired
	}
	return nil
}

// UpsertSecret writes one secret value. Create first; on a 4xx conflict,
// update. Both writes share the union response — approval-held writes
// surface as ErrApprovalRequired, never as silent success.
func (c *Client) UpsertSecret(ctx context.Context, projectID, envSlug string, s Secret) error {
	if err := c.ensureToken(ctx); err != nil {
		return err
	}
	path := s.Path
	if path == "" {
		path = "/"
	}
	body := map[string]string{
		"projectId":   projectID,
		"environment": envSlug,
		"secretPath":  path,
		"secretValue": s.Value,
	}
	ep := wireSecretsPath + "/" + url.PathEscape(s.Key)
	var out map[string]json.RawMessage
	err := c.do(ctx, http.MethodPost, ep, body, &out, true)
	if apiErr := (*APIError)(nil); errors.As(err, &apiErr) && apiErr.Status == http.StatusBadRequest {
		out = nil
		err = c.do(ctx, http.MethodPatch, ep, body, &out, true)
	}
	if err != nil {
		return err
	}
	if _, held := out["approval"]; held {
		return ErrApprovalRequired
	}
	return nil
}

type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("core api: status %d: %.200s", e.Status, e.Body)
}

func (c *Client) do(ctx context.Context, method, path string, body, out any, authed bool) error {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authed {
		c.mu.Lock()
		req.Header.Set("Authorization", "Bearer "+c.token)
		c.mu.Unlock()
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &APIError{Status: resp.StatusCode, Body: string(raw)}
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}
