// Package oidc implements Nomen browser approval from headless clients.
package oidc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"shippin.cloud/vaultix/internal/transport"
)

const DefaultIssuer = "https://auth.shippin.ai"
const maxResponse = 1 << 20

var (
	ErrNoDevice = errors.New("oidc: this issuer does not offer device login")
	ErrDenied   = errors.New("oidc: sign-in was denied; run vaultix login to try again")
	ErrExpired  = errors.New("oidc: the sign-in code expired; run vaultix login to get a new code")
	ErrNoToken  = errors.New("oidc: token response had no usable bearer access token")
	ErrClientID = errors.New("oidc: NOMEN_OIDC_CLIENT_ID is required (public Nomen client)")
)

type Flow struct {
	Issuer   string
	ClientID string
	Scope    string
	HTTP     *http.Client
	// Tests replace the wait, not the protocol's polling interval.
	wait func(context.Context, time.Duration) error
}

type Session struct {
	AccessToken string
	ExpiresAt   time.Time
}

type discovery struct {
	Issuer                      string `json:"issuer"`
	DeviceAuthorizationEndpoint string `json:"device_authorization_endpoint"`
	TokenEndpoint               string `json:"token_endpoint"`
}

type start struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	Interval                int    `json:"interval"`
	ExpiresIn               int    `json:"expires_in"`
}

func (f *Flow) Run(ctx context.Context, out io.Writer) (string, error) {
	s, err := f.RunSession(ctx, out)
	return s.AccessToken, err
}

// RunSession never opens a local callback port. Only the public approval link
// and user code reach the terminal; the device code and token stay in memory.
func (f *Flow) RunSession(ctx context.Context, out io.Writer) (Session, error) {
	if strings.TrimSpace(f.ClientID) == "" {
		return Session{}, ErrClientID
	}
	issuer := strings.TrimRight(strings.TrimSpace(f.Issuer), "/")
	if issuer == "" {
		issuer = DefaultIssuer
	}
	u, err := transport.URL(issuer)
	if err != nil || u.RawQuery != "" {
		return Session{}, errors.New("oidc: invalid issuer URL")
	}
	scope := f.Scope
	if scope == "" {
		scope = "openid profile email"
	}
	var disc discovery
	status, err := f.request(ctx, issuer+"/.well-known/openid-configuration", nil, &disc)
	if err != nil {
		return Session{}, err
	}
	if status != http.StatusOK || disc.Issuer != issuer {
		return Session{}, errors.New("oidc: discovery did not match the configured issuer")
	}
	if disc.DeviceAuthorizationEndpoint == "" || disc.TokenEndpoint == "" {
		return Session{}, ErrNoDevice
	}
	for _, endpoint := range []string{disc.DeviceAuthorizationEndpoint, disc.TokenEndpoint} {
		e, err := transport.URL(endpoint)
		if err != nil || u.Scheme == "https" && e.Scheme != "https" {
			return Session{}, errors.New("oidc: unsafe issuer endpoint")
		}
	}
	var begun start
	status, err = f.request(ctx, disc.DeviceAuthorizationEndpoint, url.Values{"client_id": {f.ClientID}, "scope": {scope}}, &begun)
	if err != nil {
		return Session{}, err
	}
	if status != http.StatusOK {
		return Session{}, fmt.Errorf("oidc: device authorization rejected (HTTP %d)", status)
	}
	if begun.DeviceCode == "" || begun.UserCode == "" || len(begun.UserCode) > 128 || strings.ContainsFunc(begun.UserCode, func(r rune) bool { return r < 32 || r == 127 }) || begun.ExpiresIn <= 0 || begun.ExpiresIn > 86400 || begun.Interval < 0 || begun.Interval > 86400 {
		return Session{}, errors.New("oidc: invalid device authorization response")
	}
	verification, err := transport.URL(begun.VerificationURI)
	if err != nil || u.Scheme == "https" && verification.Scheme != "https" {
		return Session{}, errors.New("oidc: invalid browser approval URL")
	}
	link := begun.VerificationURI
	if begun.VerificationURIComplete != "" {
		complete, err := transport.URL(begun.VerificationURIComplete)
		if err != nil || complete.Scheme != verification.Scheme || complete.Host != verification.Host {
			return Session{}, errors.New("oidc: browser approval URLs disagree")
		}
		link = begun.VerificationURIComplete
	}
	if _, err := fmt.Fprintf(out, "Sign in to Vaultix with Nomen. Open this link on any device:\n%s\nCode: %s\nApprove only the sign-in you just started. Waiting for approval...\n", link, begun.UserCode); err != nil {
		return Session{}, err
	}
	pollCtx, cancel := context.WithTimeout(ctx, time.Duration(begun.ExpiresIn)*time.Second)
	defer cancel()
	session, err := f.poll(pollCtx, disc.TokenEndpoint, begun)
	if ctx.Err() != nil {
		return Session{}, ctx.Err()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Session{}, ErrExpired
	}
	return session, err
}

// Provider error descriptions and transport URLs never become terminal output.
func (f *Flow) request(ctx context.Context, endpoint string, form url.Values, result any) (int, error) {
	method := http.MethodGet
	var body io.Reader
	if form != nil {
		method, body = http.MethodPost, strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return 0, errors.New("oidc: invalid request")
	}
	req.Header.Set("Accept", "application/json")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, err := transport.Client(f.HTTP).Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, errors.New("oidc: request failed; check connectivity and issuer trust")
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode < 400 {
		return 0, errors.New("oidc: issuer redirects are not accepted")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponse+1))
	if err != nil || len(data) > maxResponse || json.Unmarshal(data, result) != nil {
		return 0, errors.New("oidc: invalid or oversized issuer response")
	}
	return res.StatusCode, nil
}

func wait(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (f *Flow) poll(ctx context.Context, endpoint string, begun start) (Session, error) {
	interval := time.Duration(begun.Interval) * time.Second
	if interval == 0 {
		interval = 5 * time.Second
	}
	waitFor := f.wait
	if waitFor == nil {
		waitFor = wait
	}
	for {
		if err := waitFor(ctx, interval); err != nil {
			return Session{}, err
		}
		var token struct {
			AccessToken string `json:"access_token"`
			TokenType   string `json:"token_type"`
			ExpiresIn   int    `json:"expires_in"`
			Error       string `json:"error"`
		}
		status, err := f.request(ctx, endpoint, url.Values{
			"grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}, "device_code": {begun.DeviceCode}, "client_id": {f.ClientID},
		}, &token)
		if err != nil {
			return Session{}, err
		}
		if status == http.StatusOK && token.Error == "" {
			if token.AccessToken == "" || !strings.EqualFold(token.TokenType, "Bearer") || token.ExpiresIn <= 0 || token.ExpiresIn > 31536000 {
				return Session{}, ErrNoToken
			}
			return Session{AccessToken: token.AccessToken, ExpiresAt: time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)}, nil
		}
		if status != http.StatusBadRequest {
			return Session{}, fmt.Errorf("oidc: token request rejected (HTTP %d)", status)
		}
		switch token.Error {
		case "authorization_pending":
		case "slow_down":
			interval += 5 * time.Second
		case "access_denied":
			return Session{}, ErrDenied
		case "expired_token":
			return Session{}, ErrExpired
		default:
			return Session{}, errors.New("oidc: issuer rejected the sign-in request")
		}
	}
}
