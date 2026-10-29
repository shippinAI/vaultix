// Package transport defines the credential-bearing CLI transport boundary.
package transport

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// URL permits TLS, or literal loopback HTTP for local development. Credentials,
// fragments and control characters are never valid configuration here.
func URL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || strings.ContainsFunc(raw, func(r rune) bool { return r < 32 || r == 127 }) {
		return nil, errors.New("use an absolute HTTPS URL without credentials or a fragment")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && !(u.Scheme == "http" && ip != nil && ip.IsLoopback()) {
		return nil, errors.New("HTTPS is required (literal loopback HTTP is allowed for local development)")
	}
	return u, nil
}

// Client never follows redirects with credentials or device codes. Copy a
// supplied client so tests/custom trust roots do not change shared state.
func Client(source *http.Client) *http.Client {
	c := http.Client{Timeout: 20 * time.Second}
	if source != nil {
		c = *source
	}
	if c.Timeout == 0 {
		c.Timeout = 20 * time.Second
	}
	c.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return &c
}
