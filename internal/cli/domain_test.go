package cli

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestLoginDomainProtectedAccessAndSavedBinding(t *testing.T) {
	for _, flagName := range []string{"--domain", "--api"} {
		for _, accepted := range []bool{true, false} {
			t.Run(flagName+map[bool]string{true: "/accepted", false: "/denied"}[accepted], func(t *testing.T) {
				t.Setenv("VAULTIX_HOME", t.TempDir())
				t.Setenv("VAULTIX_TOKEN", "")
				t.Setenv("VAULTIX_TOKEN_FILE", "")
				keyring.MockInit()
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					if r.Method != http.MethodGet || r.URL.Path != "/api/v1/vaultix/projects" || r.Header.Get("Authorization") != "Bearer domain-credential-canary" {
						t.Error("login did not use the selected instance's protected metadata action")
					}
					if !accepted {
						w.WriteHeader(http.StatusUnauthorized)
						io.WriteString(w, `{"error":"domain-credential-canary"}`)
						return
					}
					io.WriteString(w, `{"projects":[]}`)
				}))
				defer server.Close()
				old := &Config{API: "https://previous.vaultix.example", Env: "dev", Path: "/"}
				if err := old.Save(); err != nil {
					t.Fatal(err)
				}
				before, _ := os.ReadFile(filepath.Join(Dir(), "config.json"))
				var output strings.Builder
				err := Login(context.Background(), []string{flagName + "=" + server.URL + "/", "--token"}, strings.NewReader("domain-credential-canary\n"), &output)
				if calls != 1 || (err == nil) != accepted {
					t.Fatalf("unexpected protected login outcome: calls=%d accepted=%v error=%v", calls, accepted, err)
				}
				if strings.Contains(output.String(), "domain-credential-canary") || (err != nil && strings.Contains(err.Error(), "domain-credential-canary")) {
					t.Fatal("credential escaped through output")
				}
				if !accepted {
					after, _ := os.ReadFile(filepath.Join(Dir(), "config.json"))
					if string(before) != string(after) {
						t.Fatal("rejected login changed existing configuration")
					}
					if _, err := readCred(old); err == nil {
						t.Fatal("rejected login saved credentials")
					}
					return
				}
				cfg, err := LoadConfig()
				if err != nil || cfg.API != server.URL {
					t.Fatal("selected domain was not persisted canonically")
				}
				credential, err := readCred(cfg)
				if err != nil || credential.API != server.URL {
					t.Fatal("credential was not bound to the selected instance")
				}
				if _, err := readCred(old); err == nil {
					t.Fatal("new credential was reusable at the previous instance")
				}
			})
		}
	}
}

func TestLoginDomainInputFailsBeforeCredentialUse(t *testing.T) {
	t.Setenv("VAULTIX_HOME", t.TempDir())
	t.Setenv("VAULTIX_TOKEN", "")
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ }))
	defer server.Close()
	for _, args := range [][]string{
		{"--domain="},
		{"--api="},
		{"--domain=" + server.URL, "--api=https://other.vaultix.example"},
		{"--domain=https://credential-canary@vaultix.cloud"},
		{"--domain=http://vaultix.cloud"},
		{"--domain=https://vaultix.cloud?credential-canary"},
		{"--domain=https://vaultix.cloud?"},
		{"--domain=https://vaultix.cloud#credential-canary"},
		{"--domain=" + server.URL, "unexpected"},
		{"--infisical"},
	} {
		var output strings.Builder
		err := Login(context.Background(), args, strings.NewReader("credential-canary\n"), &output)
		if err == nil || strings.Contains(err.Error(), "credential-canary") || strings.Contains(output.String(), "credential-canary") {
			t.Fatal("invalid domain/arguments were accepted or reflected credentials")
		}
	}
	if calls != 0 {
		t.Fatal("invalid configuration reached the server")
	}
	if _, err := os.Stat(filepath.Join(Dir(), "config.json")); !os.IsNotExist(err) {
		t.Fatal("invalid arguments created configuration")
	}
}

func TestVaultixCloudDefaultPreservesConfiguredInstances(t *testing.T) {
	t.Setenv("VAULTIX_HOME", t.TempDir())
	cfg, err := LoadConfig()
	if err != nil || cfg.API != "https://vaultix.cloud" {
		t.Fatal("fresh configuration must use Vaultix.cloud")
	}
	cfg.API = "https://owned.vaultix.example"
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	cfg, err = LoadConfig()
	if err != nil || cfg.API != "https://owned.vaultix.example" {
		t.Fatal("existing self-hosted instance was replaced")
	}
	if got, err := loginAPI(cfg.API, "https://VAULTIX.cloud/", "https://vaultix.cloud"); err != nil || got != "https://vaultix.cloud" {
		t.Fatal("equivalent explicit domain and compatibility flags should agree")
	}
}
