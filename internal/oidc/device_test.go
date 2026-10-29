package oidc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func issuer(t *testing.T, change func(string, map[string]any) int) (*Flow, *[]time.Duration) {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var data map[string]any
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			data = map[string]any{"issuer": server.URL, "device_authorization_endpoint": server.URL + "/device", "token_endpoint": server.URL + "/token"}
		case "/device":
			if r.Method != "POST" || r.FormValue("client_id") != "vaultix-cli" {
				t.Error("invalid device request")
			}
			data = map[string]any{"device_code": "private-device-code", "user_code": "ABCD-EFGH", "verification_uri": server.URL + "/activate", "verification_uri_complete": server.URL + "/activate?user_code=ABCD-EFGH", "expires_in": 60}
		case "/token":
			if r.FormValue("device_code") != "private-device-code" || r.FormValue("grant_type") != "urn:ietf:params:oauth:grant-type:device_code" {
				t.Error("invalid token request")
			}
			data = map[string]any{"access_token": "private-access-token", "token_type": "Bearer", "expires_in": 3600}
		default:
			http.NotFound(w, r)
			return
		}
		status := http.StatusOK
		if change != nil {
			status = change(r.URL.Path, data)
		}
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(data)
	}))
	t.Cleanup(server.Close)
	var waits []time.Duration
	return &Flow{Issuer: server.URL, ClientID: "vaultix-cli", HTTP: server.Client(), wait: func(ctx context.Context, d time.Duration) error { waits = append(waits, d); return ctx.Err() }}, &waits
}

func TestDeviceFlowPollingAndPrivacy(t *testing.T) {
	polls := 0
	f, waits := issuer(t, func(path string, data map[string]any) int {
		if path != "/token" {
			return 200
		}
		polls++
		if polls == 1 {
			data["error"] = "authorization_pending"
			return 400
		}
		if polls == 2 {
			data["error"] = "slow_down"
			return 400
		}
		return 200
	})
	var out strings.Builder
	s, err := f.RunSession(context.Background(), &out)
	if err != nil || s.AccessToken != "private-access-token" || time.Until(s.ExpiresAt) < 59*time.Minute {
		t.Fatalf("session failed: %v", err)
	}
	if len(*waits) != 3 || (*waits)[0] != 5*time.Second || (*waits)[1] != 5*time.Second || (*waits)[2] != 10*time.Second {
		t.Fatalf("wrong waits: %v", *waits)
	}
	if !strings.Contains(out.String(), "/activate?user_code=ABCD-EFGH") || strings.Contains(out.String(), "private-") {
		t.Fatal("invalid browser guidance or credential leak")
	}
}

func TestDeviceFlowRejectsInvalidIssuerResponses(t *testing.T) {
	cases := []struct {
		name, path, key string
		value           any
		status          int
	}{
		{"issuer-mismatch", "/.well-known/openid-configuration", "issuer", "https://wrong.example", 200},
		{"unsafe-endpoint", "/.well-known/openid-configuration", "token_endpoint", "http://remote.example/token", 200},
		{"no-device", "/.well-known/openid-configuration", "device_authorization_endpoint", "", 200},
		{"missing-code", "/device", "device_code", "", 200},
		{"expired-code", "/device", "expires_in", 0, 200},
		{"unsafe-link", "/device", "verification_uri", "javascript:alert(1)", 200},
		{"different-link", "/device", "verification_uri_complete", "https://wrong.example/activate", 200},
		{"terminal-control", "/device", "user_code", "\x1b[31m", 200},
		{"negative-interval", "/device", "interval", -1, 200},
		{"http-error-with-token", "/token", "access_token", "private-access-token", 500},
		{"no-expiry", "/token", "expires_in", 0, 200},
		{"wrong-token-type", "/token", "token_type", "Basic", 200},
		{"empty-token", "/token", "access_token", "", 200},
		{"provider-error", "/token", "error", "private-provider-error", 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, _ := issuer(t, func(path string, data map[string]any) int {
				if path == tc.path {
					data[tc.key] = tc.value
					return tc.status
				}
				return 200
			})
			_, err := f.Run(context.Background(), io.Discard)
			if err == nil || strings.Contains(err.Error(), "private-") {
				t.Fatal("invalid response accepted or error leaked")
			}
		})
	}
}

func TestDeviceFlowDenialExpiryAndCancellation(t *testing.T) {
	for _, tc := range []struct {
		code string
		want error
	}{{"access_denied", ErrDenied}, {"expired_token", ErrExpired}} {
		t.Run(tc.code, func(t *testing.T) {
			f, _ := issuer(t, func(path string, data map[string]any) int {
				if path == "/token" {
					data["error"] = tc.code
					return 400
				}
				return 200
			})
			_, err := f.Run(context.Background(), io.Discard)
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v", err)
			}
		})
	}
	f, _ := issuer(t, nil)
	f.wait = wait
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.Run(ctx, io.Discard); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
}

func TestMissingClientID(t *testing.T) {
	if _, err := (&Flow{}).Run(context.Background(), io.Discard); !errors.Is(err, ErrClientID) {
		t.Fatal(err)
	}
}

func TestIssuerRedirectNotFollowed(t *testing.T) {
	visited := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { visited = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	_, err := (&Flow{Issuer: source.URL, ClientID: "cli"}).Run(context.Background(), io.Discard)
	if err == nil || visited {
		t.Fatal("issuer redirect accepted")
	}
}
