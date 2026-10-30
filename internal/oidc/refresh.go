package oidc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"shippin.cloud/vaultix/internal/transport"
)

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
}

func (t tokenResponse) session() (Session, error) {
	if t.AccessToken == "" || !strings.EqualFold(t.TokenType, "Bearer") || t.ExpiresIn <= 0 || t.ExpiresIn > 31536000 {
		return Session{}, ErrNoToken
	}
	return Session{AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, ExpiresAt: time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)}, nil
}

// RefreshSession uses the endpoint bound to the approved login. Discovery or
// environment changes cannot redirect a saved refresh token. No automatic retry:
// after an ambiguous response the issuer may already have rotated the token.
func (f *Flow) RefreshSession(ctx context.Context, endpoint, refreshToken string) (Session, error) {
	i, err := transport.URL(f.Issuer)
	if err != nil || i.RawQuery != "" || strings.TrimSpace(f.ClientID) == "" || refreshToken == "" {
		return Session{}, errors.New("oidc: incomplete saved sign-in; run vaultix login again")
	}
	e, err := transport.URL(endpoint)
	if err != nil || i.Scheme == "https" && e.Scheme != "https" {
		return Session{}, errors.New("oidc: unsafe saved token endpoint; run vaultix login again")
	}
	var token tokenResponse
	status, err := f.request(ctx, endpoint, url.Values{
		"grant_type": {"refresh_token"}, "client_id": {f.ClientID}, "refresh_token": {refreshToken},
	}, &token)
	if err != nil {
		return Session{}, err
	}
	if status != http.StatusOK || token.Error != "" {
		return Session{}, errors.New("oidc: renewal rejected; run vaultix login again")
	}
	s, err := token.session()
	if err != nil {
		return Session{}, err
	}
	// RFC 6749 section 6: a replacement is optional; when supplied it replaces
	// the old refresh token. The issuer owns rotation/replay detection policy.
	if s.RefreshToken == "" {
		s.RefreshToken = refreshToken
	}
	s.Issuer, s.TokenEndpoint = f.Issuer, endpoint
	return s, nil
}
