package cli

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/zalando/go-keyring"
	"shippin.cloud/vaultix/internal/store"
)

// The child writes its start marker before checking the independently supplied
// expected digest. A failed child is not mistaken for a child that never started.
func TestRunWorkloadProcess(t *testing.T) {
	if os.Getenv("VAULTIX_RUN_TEST_CHILD") != "1" {
		return
	}
	if err := os.WriteFile(os.Getenv("VAULTIX_RUN_TEST_MARKER"), []byte("started"), 0600); err != nil {
		os.Exit(40)
	}
	actual := fmt.Sprintf("%x", sha256.Sum256([]byte(os.Getenv("VAULTIX_RUN_CANARY"))))
	if actual != os.Getenv("VAULTIX_RUN_TEST_EXPECTED") {
		os.Exit(41)
	}
	os.Exit(0)
}

func TestRunRequiresOnlineSyncOrExplicitOffline(t *testing.T) {
	for _, tc := range []struct {
		name                                                       string
		status                                                     int
		badJSON, projectFailure, closed, canceled, offline, starts bool
	}{
		{name: "fresh-online-value", starts: true},
		{name: "revoked-token", status: 401},
		{name: "permission-denied", status: 403},
		{name: "missing-scope", status: 404},
		{name: "rate-limit", status: 429},
		{name: "server-unavailable", status: 503},
		{name: "invalid-secret-response", badJSON: true},
		{name: "project-denied", status: 403, projectFailure: true},
		{name: "network-unavailable", closed: true},
		{name: "canceled", canceled: true},
		{name: "explicit-offline", offline: true, starts: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("VAULTIX_HOME", home)
			t.Setenv("VAULTIX_TOKEN", "run-fixture-token")
			t.Setenv("VAULTIX_TOKEN_FILE", "")
			t.Setenv("VAULTIX_RUN_TEST_CHILD", "1")
			marker := filepath.Join(home, "child-started")
			t.Setenv("VAULTIX_RUN_TEST_MARKER", marker)
			value := "online-fixture-value"
			if tc.offline {
				value = "cached-fixture-value"
			}
			t.Setenv("VAULTIX_RUN_TEST_EXPECTED", fmt.Sprintf("%x", sha256.Sum256([]byte(value))))
			calls := &atomic.Int32{}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer run-fixture-token" {
					t.Error("missing credential")
					w.WriteHeader(401)
					return
				}
				if r.URL.Path == "/api/v2/workspace/run-project" && !tc.projectFailure {
					io.WriteString(w, `{"id":"project-fixture"}`)
					return
				}
				if tc.status != 0 {
					w.WriteHeader(tc.status)
					io.WriteString(w, `{"error":"cached-fixture-value"}`)
					return
				}
				if tc.badJSON {
					io.WriteString(w, "{")
					return
				}
				if r.URL.Path != "/api/v3/secrets/raw" || r.URL.Query().Get("workspaceId") != "project-fixture" {
					t.Error("unexpected scope request")
					w.WriteHeader(400)
					return
				}
				io.WriteString(w, `{"secrets":[{"secretKey":"VAULTIX_RUN_CANARY","secretValue":"online-fixture-value","version":2}]}`)
			}))
			defer srv.Close()
			if tc.closed {
				srv.Close()
			}
			cfg := &Config{API: srv.URL, Project: "run-project", Env: "dev", Path: "/"}
			if err := cfg.Save(); err != nil {
				t.Fatal(err)
			}
			keyring.MockInit()
			key, err := store.DataKey("")
			if err != nil {
				t.Fatal(err)
			}
			st := &store.Store{Dir: home, Key: key}
			if err := st.Save(cfg.scopeName(), &store.Scope{Entries: map[string]store.Entry{"VAULTIX_RUN_CANARY": {Value: "cached-fixture-value", Base: 1}}}); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.canceled {
				cancel()
			}
			var diagnostics strings.Builder
			err = Run(ctx, []string{os.Args[0], "-test.run=^TestRunWorkloadProcess$"}, tc.offline, &diagnostics)
			if tc.starts {
				if err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(marker); err != nil {
					t.Fatal("workload never started")
				}
			} else {
				if err == nil || !strings.Contains(err.Error(), "workload was not started") {
					t.Fatalf("missing fail-closed result: %v", err)
				}
				if _, err := os.Stat(marker); !os.IsNotExist(err) {
					t.Fatal("failed sync started a workload")
				}
			}
			if tc.offline && (calls.Load() != 0 || !strings.Contains(diagnostics.String(), "without checking current server access")) {
				t.Fatal("offline semantics not explicit")
			}
			if !tc.offline && diagnostics.Len() != 0 {
				t.Fatal("unexpected fallback diagnostics")
			}
			for _, sensitive := range []string{"run-fixture-token", "cached-fixture-value", "online-fixture-value"} {
				if strings.Contains(diagnostics.String(), sensitive) || (err != nil && strings.Contains(err.Error(), sensitive)) {
					t.Fatal("sensitive fixture disclosed")
				}
			}
		})
	}
}
