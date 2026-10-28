package oidc

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestDeviceFlowPrintsLinkAndHidesToken(t *testing.T) {
	var polls int
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			io.WriteString(w, `{"device_authorization_endpoint":"`+strings.TrimRight(r.Host, "")+`","token_endpoint":"tok"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	// Rewrite discovery to absolute URLs on this server.
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			io.WriteString(w, `{"device_authorization_endpoint":"`+srv.URL+`/device","token_endpoint":"`+srv.URL+`/token"}`)
		case "/device":
			io.WriteString(w, `{"device_code":"dev-1","user_code":"ABCD-EFGH","verification_uri":"`+srv.URL+`/activate","verification_uri_complete":"`+srv.URL+`/activate?user_code=ABCD-EFGH","interval":0,"expires_in":30}`)
		case "/token":
			mu.Lock()
			polls++
			n := polls
			mu.Unlock()
			if n == 1 {
				io.WriteString(w, `{"error":"authorization_pending"}`)
				return
			}
			io.WriteString(w, `{"access_token":"secret-token-value","token_type":"Bearer"}`)
		default:
			http.NotFound(w, r)
		}
	})

	var out strings.Builder
	flow := &Flow{Issuer: srv.URL, ClientID: "vaultix-cli", HTTP: srv.Client()}
	tok, err := flow.Run(context.Background(), &out)
	if err != nil {
		t.Fatal(err)
	}
	if tok != "secret-token-value" {
		t.Fatalf("token: %q", tok)
	}
	text := out.String()
	if !strings.Contains(text, "ABCD-EFGH") || !strings.Contains(text, "/activate?user_code=ABCD-EFGH") {
		t.Fatalf("link missing: %s", text)
	}
	if strings.Contains(text, "secret-token-value") {
		t.Fatal("access token was printed")
	}
}

func TestMissingClientID(t *testing.T) {
	_, err := (&Flow{Issuer: "https://auth.example"}).Run(context.Background(), io.Discard)
	if err != ErrClientID {
		t.Fatalf("got %v", err)
	}
}
