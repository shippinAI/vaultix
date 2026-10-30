// Package nomen validates the pinned Nomen introspection profile. Its result is
// not a Vaultix actor: account binding, tenant and permission checks are separate.
// This component is not registered on any production route.
package nomen

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrConfiguration = errors.New("nomen introspection configuration is invalid")
	ErrUnavailable   = errors.New("nomen authentication is temporarily unavailable")
	ErrInvalidToken  = errors.New("nomen credential is invalid")
)

const (
	maxResponseBytes = 64 * 1024
	maxTokenBytes    = 16 * 1024
	requestTimeout   = 3 * time.Second
)

// Config is an explicit resource-server profile, not browser/client discovery.
// Public-client registration, token purpose and account mapping require separate
// acceptance before any route can use this component as part of authentication.
type Config struct {
	Issuer           string
	Endpoint         string
	Audience         string
	AllowedClientIDs []string
	RequiredScopes   []string
}

type VerifierDeps struct {
	Config      Config
	Credentials ClientCredentials
	HTTPClient  *http.Client
}

type Verifier struct {
	issuer      string
	endpoint    string
	audience    string
	clients     map[string]bool
	scopes      map[string]bool
	credentials ClientCredentials
	http        http.Client
}

// NewVerifier validates configuration and pinned public discovery before it can
// send credentials. Discovery never selects a different introspection endpoint.
func NewVerifier(ctx context.Context, logger *slog.Logger, deps *VerifierDeps) (*Verifier, error) {
	if deps == nil || logger == nil {
		return nil, ErrConfiguration
	}
	cfg := deps.Config
	issuer, err := secureURL(cfg.Issuer)
	if err != nil {
		return nil, ErrConfiguration
	}
	endpoint, err := secureURL(cfg.Endpoint)
	if err != nil || endpoint.Host != issuer.Host || !identifier(cfg.Audience, 2048) {
		return nil, ErrConfiguration
	}
	if err := deps.Credentials.validate(); err != nil {
		return nil, err
	}
	clients, scopes := make(map[string]bool), make(map[string]bool)
	for _, client := range cfg.AllowedClientIDs {
		if !identifier(client, 255) || clients[client] {
			return nil, ErrConfiguration
		}
		clients[client] = true
	}
	for _, scope := range cfg.RequiredScopes {
		if !validScope(scope) || scopes[scope] {
			return nil, ErrConfiguration
		}
		scopes[scope] = true
	}
	if len(clients) == 0 || len(scopes) == 0 {
		return nil, ErrConfiguration
	}
	client := http.Client{}
	if deps.HTTPClient != nil {
		client = *deps.HTTPClient
	}
	// A caller-supplied transport can provide private trust roots, but cannot
	// relax redirect handling or the maximum request deadline.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if client.Timeout <= 0 || client.Timeout > requestTimeout {
		client.Timeout = requestTimeout
	}
	v := &Verifier{issuer: cfg.Issuer, endpoint: cfg.Endpoint, audience: cfg.Audience,
		clients: clients, scopes: scopes, credentials: deps.Credentials, http: client}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(cfg.Issuer, "/")+"/.well-known/openid-configuration", http.NoBody)
	if err != nil {
		return nil, ErrConfiguration
	}
	discovery, err := v.request(request)
	if err != nil {
		return nil, err
	}
	var foundIssuer, foundEndpoint string
	var methods []string
	if json.Unmarshal(discovery["issuer"], &foundIssuer) != nil || foundIssuer != cfg.Issuer ||
		json.Unmarshal(discovery["introspection_endpoint"], &foundEndpoint) != nil || foundEndpoint != cfg.Endpoint ||
		json.Unmarshal(discovery["introspection_endpoint_auth_methods_supported"], &methods) != nil {
		return nil, ErrConfiguration
	}
	for _, method := range methods {
		if method == string(v.credentials.Method) {
			logger.DebugContext(ctx, "Pinned Nomen introspection profile initialized")
			return v, nil
		}
	}
	return nil, ErrConfiguration
}

// Introspect validates token claims on every call, without a positive cache.
// It never mints a session, loads an account or grants organization membership.
// token_type_hint is only a request hint, not proof of token purpose; production
// activation also requires live rejection of provider ID and refresh tokens.
func (v *Verifier) Introspect(ctx context.Context, token string) (*Claims, error) {
	if !identifier(token, maxTokenBytes) || strings.ContainsAny(token, " \t\r\n") {
		return nil, ErrInvalidToken
	}
	if ctx.Err() != nil {
		return nil, ErrUnavailable
	}
	form := url.Values{"token": {token}, "token_type_hint": {"access_token"}}
	if err := v.credentials.addAssertion(form, v.issuer, time.Now()); err != nil {
		return nil, ErrUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, v.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, ErrUnavailable
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if v.credentials.Method == ClientSecretBasic {
		// OAuth Basic credentials are form-encoded before Base64 encoding.
		request.SetBasicAuth(url.QueryEscape(v.credentials.ClientID), url.QueryEscape(v.credentials.Secret))
	}
	response, err := v.request(request)
	if err != nil {
		return nil, err
	}
	return v.claims(response, time.Now())
}

func (v *Verifier) request(request *http.Request) (fields map[string]json.RawMessage, resultErr error) {
	request.Header.Set("Accept", "application/json")
	response, err := v.http.Do(request)
	if err != nil {
		// Transport errors can contain request URLs/headers. Do not retain or log
		// them, upstream bodies, assertions, bearer tokens or resource credentials.
		return nil, ErrUnavailable
	}
	defer func() {
		// An incomplete transport lifecycle must not yield authenticated claims.
		if err := response.Body.Close(); err != nil {
			fields, resultErr = nil, ErrUnavailable
		}
	}()
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode != http.StatusOK || err != nil || mediaType != "application/json" {
		return nil, ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(body) > maxResponseBytes {
		return nil, ErrUnavailable
	}
	return object(body)
}

// Reject duplicate top-level security claims instead of accepting the last one.
// Unknown provider claims are bounded and ignored, not copied into an actor.
func object(body []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return nil, ErrUnavailable
	}
	fields := make(map[string]json.RawMessage)
	for decoder.More() {
		key, err := decoder.Token()
		name, ok := key.(string)
		if err != nil || !ok || len(fields) >= 128 {
			return nil, ErrUnavailable
		}
		if _, exists := fields[name]; exists {
			return nil, ErrUnavailable
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return nil, ErrUnavailable
		}
		fields[name] = value
	}
	if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
		return nil, ErrUnavailable
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, ErrUnavailable
	}
	return fields, nil
}

func secureURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || !identifier(raw, 2048) || u.Scheme != "https" || u.Host == "" || u.User != nil ||
		strings.ContainsAny(raw, "?#") || strings.TrimSpace(raw) != raw {
		return nil, ErrConfiguration
	}
	return u, nil
}

func identifier(value string, limit int) bool {
	return value != "" && len(value) <= limit && strings.TrimSpace(value) != "" &&
		!strings.ContainsFunc(value, func(r rune) bool { return r < 32 || r == 127 })
}
