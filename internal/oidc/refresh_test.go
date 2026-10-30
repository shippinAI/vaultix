package oidc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRefreshRotationAndOptionalReplacement(t *testing.T) {
	for _, replacement := range []string{"private-next-refresh", ""} {
		t.Run(replacement, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.FormValue("grant_type") != "refresh_token" || r.FormValue("client_id") != "public-cli" || r.FormValue("refresh_token") != "private-refresh" || r.FormValue("client_secret") != "" || r.FormValue("scope") != "" {
					t.Error("wrong renewal form")
				}
				json.NewEncoder(w).Encode(map[string]any{"access_token": "private-access", "refresh_token": replacement, "token_type": "Bearer", "expires_in": 60})
			}))
			defer srv.Close()
			s, err := (&Flow{Issuer: srv.URL, ClientID: "public-cli"}).RefreshSession(context.Background(), srv.URL+"/token", "private-refresh")
			if err != nil {
				t.Fatal(err)
			}
			want := replacement
			if want == "" {
				want = "private-refresh"
			}
			if s.RefreshToken != want || s.AccessToken != "private-access" || time.Until(s.ExpiresAt) < 50*time.Second || s.TokenEndpoint != srv.URL+"/token" || s.Issuer != srv.URL {
				t.Fatal("incomplete renewed session")
			}
		})
	}
}

func TestRefreshRejectsErrorsWithoutReplayOrDisclosure(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"revoked", 400, `{"error":"invalid_grant","error_description":"private-refresh"}`},
		{"http-success-with-error", 200, `{"error":"private-error","access_token":"private-access","token_type":"Bearer","expires_in":60}`},
		{"missing-lifetime", 200, `{"access_token":"private-access","token_type":"Bearer"}`},
		{"wrong-type", 200, `{"access_token":"private-access","token_type":"Basic","expires_in":60}`},
		{"malformed", 200, `private-invalid-json`},
		{"oversized", 200, strings.Repeat("x", maxResponse+1)},
		{"server-error", 500, `{"access_token":"private-access","token_type":"Bearer","expires_in":60}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.body)
			}))
			defer srv.Close()
			_, err := (&Flow{Issuer: srv.URL, ClientID: "public-cli"}).RefreshSession(context.Background(), srv.URL, "private-refresh")
			if err == nil || strings.Contains(err.Error(), "private-") || calls != 1 {
				t.Fatal("accepted, replayed or disclosed invalid refresh response")
			}
		})
	}
}

func TestRefreshRejectsRedirectDowngradeAndCancellation(t *testing.T) {
	visited := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { visited = true }))
	defer target.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer srv.Close()
	f := &Flow{Issuer: srv.URL, ClientID: "public-cli"}
	if _, err := f.RefreshSession(context.Background(), srv.URL, "private-refresh"); err == nil || visited {
		t.Fatal("redirect followed")
	}
	f.Issuer = "https://issuer.example"
	if _, err := f.RefreshSession(context.Background(), target.URL, "private-refresh"); err == nil || visited {
		t.Fatal("TLS downgraded")
	}
	f.Issuer = target.URL
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.RefreshSession(ctx, target.URL, "private-refresh"); err != context.Canceled || visited {
		t.Fatal("cancellation lost")
	}
}

func TestDeviceSessionRetainsRefreshBinding(t *testing.T) {
	f, _ := issuer(t, func(path string, data map[string]any) int {
		if path == "/token" {
			data["refresh_token"] = "private-refresh"
		}
		return 200
	})
	var out strings.Builder
	s, err := f.RunSession(context.Background(), &out)
	if err != nil || s.RefreshToken != "private-refresh" || s.Issuer != f.Issuer || s.TokenEndpoint != f.Issuer+"/token" || strings.Contains(out.String(), "private-") {
		t.Fatal("refresh binding missing or disclosed")
	}
}
