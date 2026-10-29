package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVerifyProtectedAccess(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		pass       bool
	}{
		{"empty-authorized", `{"projects":[]}`, 200, true},
		{"health-only", `{"status":"ok"}`, 200, false},
		{"null-projects", `{"projects":null}`, 200, false},
		{"denied", `{"error":"private-token"}`, 401, false},
		{"forbidden", `{"error":"private-token"}`, 403, false},
		{"unavailable", `{"error":"private-token"}`, 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v1/vaultix/projects" || r.Header.Get("Authorization") != "Bearer private-token" {
					t.Error("not protected project verification")
				}
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			err := New(srv.URL, "private-token").VerifyAccess(context.Background())
			if (err == nil) != tc.pass || err != nil && strings.Contains(err.Error(), "private-token") {
				t.Fatalf("incorrect access result: %v", err)
			}
		})
	}
}

func TestCredentialRedirectRejected(t *testing.T) {
	visited := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { visited = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	if err := New(source.URL, "private-token").VerifyAccess(context.Background()); err == nil || visited {
		t.Fatal("credential redirect accepted")
	}
}
