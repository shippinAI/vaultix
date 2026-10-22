// Package oidc signs a person in through Nomen (Zitadel) with the OAuth
// device-code flow. The CLI prints a browser link. The user never types a
// password or pastes a token into the terminal.
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
)

const defaultScope = "openid profile email"

// DefaultIssuer is the community Nomen issuer. Self-host overrides it.
const DefaultIssuer = "https://auth.shippin.ai"

var (
	ErrNoDevice = errors.New("oidc: this issuer does not offer device login")
	ErrDenied   = errors.New("oidc: sign-in was denied")
	ErrExpired  = errors.New("oidc: the sign-in code expired")
	ErrNoToken  = errors.New("oidc: token response had no access token")
	ErrClientID = errors.New("oidc: NOMEN_OIDC_CLIENT_ID is required (public Nomen client)")
)

// Flow talks to one issuer.
type Flow struct {
	Issuer   string
	ClientID string
	Scope    string
	HTTP     *http.Client
}

type discovery struct {
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

// Run prints the link and polls until Nomen returns an access token.
// The token is returned to the caller and is not written to out.
func (f *Flow) Run(ctx context.Context, out io.Writer) (string, error) {
	if strings.TrimSpace(f.ClientID) == "" {
		return "", ErrClientID
	}
	issuer := strings.TrimRight(strings.TrimSpace(f.Issuer), "/")
	if issuer == "" {
		issuer = DefaultIssuer
	}
	if f.Scope == "" {
		f.Scope = defaultScope
	}
	if f.HTTP == nil {
		f.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	disc, err := f.discover(ctx, issuer)
	if err != nil {
		return "", err
	}
	if disc.DeviceAuthorizationEndpoint == "" || disc.TokenEndpoint == "" {
		return "", ErrNoDevice
	}
	started, err := f.begin(ctx, disc.DeviceAuthorizationEndpoint)
	if err != nil {
		return "", err
	}
	link := started.VerificationURIComplete
	if link == "" {
		link = started.VerificationURI
	}
	fmt.Fprintf(out, "Sign in with Nomen. Open this link:\n%s\n", link)
	if started.UserCode != "" {
		fmt.Fprintf(out, "Code: %s\n", started.UserCode)
	}
	fmt.Fprintln(out, "Waiting for the browser…")
	return f.poll(ctx, disc.TokenEndpoint, started)
}

func (f *Flow) discover(ctx context.Context, issuer string) (discovery, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, issuer+"/.well-known/openid-configuration", nil)
	if err != nil {
		return discovery{}, err
	}
	res, err := f.HTTP.Do(req)
	if err != nil {
		return discovery{}, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode/100 != 2 {
		return discovery{}, fmt.Errorf("oidc: discovery HTTP %d", res.StatusCode)
	}
	var disc discovery
	if err := json.Unmarshal(body, &disc); err != nil {
		return discovery{}, err
	}
	return disc, nil
}

func (f *Flow) begin(ctx context.Context, endpoint string) (start, error) {
	form := url.Values{"client_id": {f.ClientID}, "scope": {f.Scope}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return start{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := f.HTTP.Do(req)
	if err != nil {
		return start{}, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode/100 != 2 {
		return start{}, fmt.Errorf("oidc: device authorization HTTP %d", res.StatusCode)
	}
	var started start
	if err := json.Unmarshal(body, &started); err != nil {
		return start{}, err
	}
	if started.DeviceCode == "" {
		return start{}, errors.New("oidc: device authorization returned no device code")
	}
	return started, nil
}

func (f *Flow) poll(ctx context.Context, endpoint string, started start) (string, error) {
	interval := time.Duration(started.Interval) * time.Second
	if interval < 5*time.Millisecond {
		interval = 5 * time.Millisecond
	}
	deadline := time.Now().Add(10 * time.Minute)
	if started.ExpiresIn > 0 {
		deadline = time.Now().Add(time.Duration(started.ExpiresIn) * time.Second)
	}
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if time.Now().After(deadline) {
			return "", ErrExpired
		}
		form := url.Values{
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
			"device_code": {started.DeviceCode},
			"client_id":   {f.ClientID},
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, err := f.HTTP.Do(req)
		if err != nil {
			return "", err
		}
		body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		res.Body.Close()
		var tok struct {
			AccessToken string `json:"access_token"`
			Error       string `json:"error"`
		}
		if err := json.Unmarshal(body, &tok); err != nil {
			return "", err
		}
		switch tok.Error {
		case "":
			if tok.AccessToken == "" {
				return "", ErrNoToken
			}
			return tok.AccessToken, nil
		case "authorization_pending":
		case "slow_down":
			interval += 5 * time.Second
		case "access_denied":
			return "", ErrDenied
		case "expired_token":
			return "", ErrExpired
		default:
			return "", fmt.Errorf("oidc: %s", tok.Error)
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}
	}
}
