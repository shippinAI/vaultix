package cli

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"shippin.cloud/vaultix/internal/api"
	"shippin.cloud/vaultix/internal/store"
)

// cred is what login keeps in the OS keyring: a token (PAT/access token) or a universal-auth pair.
type cred struct {
	Type         string    `json:"type"` // "token" | "universal"
	Token        string    `json:"token,omitempty"`
	ClientID     string    `json:"client_id,omitempty"`
	ClientSecret string    `json:"client_secret,omitempty"`
	API          string    `json:"api,omitempty"`
	ExpiresAt    time.Time `json:"expires_at,omitempty"`
}

// session is an authenticated client plus the resolved scope and local store.
type session struct {
	cfg   *Config
	c     *api.Client
	scope api.Scope
	st    *store.Store
}

func readCred(cfg *Config) (*cred, error) {
	var raw string
	var err error
	if cfg.CredentialFile != "" && os.Getenv("VAULTIX_TOKEN") == "" && os.Getenv("VAULTIX_TOKEN_FILE") == "" {
		raw, err = store.CredentialFile(cfg.CredentialFile, "")
	} else {
		raw, err = store.Credential("")
	}
	if err != nil {
		return nil, errors.New("not logged in: run `vaultix login` (or set VAULTIX_TOKEN / VAULTIX_TOKEN_FILE)")
	}
	var c cred
	if json.Unmarshal([]byte(raw), &c) != nil || c.Type == "" {
		c = cred{Type: "token", Token: raw} // a bare token from the env or a file
	}
	if c.API != "" && strings.TrimRight(c.API, "/") != strings.TrimRight(cfg.API, "/") {
		return nil, errors.New("credential belongs to a different Vaultix instance; run vaultix login --api for this instance")
	}
	if !c.ExpiresAt.IsZero() && !time.Now().Before(c.ExpiresAt) {
		return nil, errors.New("Vaultix sign-in expired; run vaultix login again")
	}
	return &c, nil
}

func authenticatedClient(ctx context.Context, cfg *Config) (*api.Client, error) {
	return (&clientSession{cfg: cfg}).client(ctx)
}

// clientSession is owned by one serial CLI/MCP connection. Machine tokens are
// reused until near expiry, while saved credentials are checked on every call.
type clientSession struct {
	cfg         *Config
	fingerprint [32]byte
	cached      *api.Client
	validUntil  time.Time
}

func (s *clientSession) client(ctx context.Context) (*api.Client, error) {
	cr, err := readCred(s.cfg)
	if err != nil {
		return nil, err
	}
	tok := cr.Token
	if cr.Type == "universal" {
		encoded, _ := json.Marshal(cr)
		fingerprint := sha256.Sum256(encoded)
		if s.cached != nil && s.fingerprint == fingerprint && time.Now().Before(s.validUntil) {
			return s.cached, nil
		}
		var lifetime time.Duration
		if tok, lifetime, err = api.UniversalLogin(ctx, s.cfg.API, cr.ClientID, cr.ClientSecret); err != nil {
			return nil, err
		}
		// Leave a small renewal margin even for short-lived identity tokens.
		margin := min(30*time.Second, lifetime/10)
		s.fingerprint, s.validUntil = fingerprint, time.Now().Add(lifetime-margin)
		s.cached = api.New(s.cfg.API, tok)
		return s.cached, nil
	}
	if tok == "" {
		return nil, errors.New("no access token; run vaultix login")
	}
	return api.New(s.cfg.API, tok), nil
}

func open(ctx context.Context, cfg *Config) (*session, error) {
	if cfg.Project == "" {
		return nil, errors.New("no project: run `vaultix init --project <slug> --env <env>`")
	}
	c, err := authenticatedClient(ctx, cfg)
	if err != nil {
		return nil, err
	}
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
