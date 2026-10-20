package cli

import (
	"context"
	"encoding/json"
	"errors"

	"shippin.cloud/vaultix/internal/api"
	"shippin.cloud/vaultix/internal/store"
)

// cred is what login keeps in the OS keyring: a token (PAT/access token) or a universal-auth pair.
type cred struct {
	Type         string `json:"type"` // "token" | "universal"
	Token        string `json:"token,omitempty"`
	ClientID     string `json:"client_id,omitempty"`
	ClientSecret string `json:"client_secret,omitempty"`
}

// session is an authenticated client plus the resolved scope and local store.
type session struct {
	cfg   *Config
	c     *api.Client
	scope api.Scope
	st    *store.Store
}

func readCred() (*cred, error) {
	raw, err := store.Credential("")
	if err != nil {
		return nil, errors.New("not logged in: run `vaultix login` (or set VAULTIX_TOKEN / VAULTIX_TOKEN_FILE)")
	}
	var c cred
	if json.Unmarshal([]byte(raw), &c) != nil || c.Type == "" {
		c = cred{Type: "token", Token: raw} // a bare token from the env or a file
	}
	return &c, nil
}

func open(ctx context.Context, cfg *Config) (*session, error) {
	if cfg.Project == "" {
		return nil, errors.New("no project: run `vaultix init --project <slug> --env <env>`")
	}
	cr, err := readCred()
	if err != nil {
		return nil, err
	}
	tok := cr.Token
	if cr.Type == "universal" {
		if tok, _, err = api.UniversalLogin(ctx, cfg.API, cr.ClientID, cr.ClientSecret); err != nil {
			return nil, err
		}
	}
	c := api.New(cfg.API, tok)
	pid, err := c.ProjectID(ctx, cfg.Project)
	if err != nil {
		return nil, err
	}
	key, err := store.DataKey(cfg.KeyFile)
	if err != nil {
		return nil, err
	}
	return &session{cfg: cfg, c: c, scope: api.Scope{Project: pid, Env: cfg.Env, Path: cfg.Path}, st: &store.Store{Dir: Dir(), Key: key}}, nil
}
