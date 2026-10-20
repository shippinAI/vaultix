package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientFlow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/auth/universal-auth/login":
			json.NewEncoder(w).Encode(map[string]any{"accessToken": "tok", "expiresIn": 60})
		case r.Header.Get("Authorization") != "Bearer tok":
			w.WriteHeader(401)
		case r.URL.Path == "/api/v2/workspace/proj":
			json.NewEncoder(w).Encode(map[string]string{"id": "pid"})
		case r.URL.Path == "/api/v3/secrets/raw" && r.URL.Query().Get("workspaceId") == "pid":
			json.NewEncoder(w).Encode(map[string]any{"secrets": []map[string]any{{"secretKey": "A", "secretValue": "v", "version": 2}}})
		case r.URL.Path == "/api/v3/secrets/raw/B" && r.Method == http.MethodPost:
			json.NewEncoder(w).Encode(map[string]any{"secret": map[string]any{"secretKey": "B", "version": 1}})
		default:
			w.WriteHeader(404)
			w.Write([]byte(`{"message":"nope"}`))
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	tok, _, err := UniversalLogin(ctx, srv.URL, "id", "sec")
	if err != nil || tok != "tok" {
		t.Fatal(err)
	}
	c := New(srv.URL, tok)
	pid, err := c.ProjectID(ctx, "proj")
	if err != nil || pid != "pid" {
		t.Fatal(pid, err)
	}
	s := Scope{Project: pid, Env: "dev"}
	l, err := c.List(ctx, s)
	if err != nil || len(l) != 1 || l[0].Version != 2 {
		t.Fatal(l, err)
	}
	if v, err := c.Put(ctx, s, "B", "x", true); err != nil || v != 1 {
		t.Fatal(v, err)
	}
	if _, err := c.ProjectID(ctx, "missing"); !NotFound(err) {
		t.Fatal(err)
	}
}
