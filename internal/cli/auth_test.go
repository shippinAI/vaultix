package cli

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestHeadlessUniversalLoginDoesNotCallSso(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX credential file tested on Linux; Windows uses the keyring")
	}
	home := t.TempDir()
	os.Chmod(home, 0700)
	t.Setenv("VAULTIX_HOME", home)
	t.Setenv("VAULTIX_TOKEN", "")
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	t.Setenv("NOMEN_OIDC_ISSUER", "https://issuer.example")
	t.Setenv("NOMEN_OIDC_CLIENT_ID", "public-client")
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/api/v1/auth/universal-auth/login":
			io.WriteString(w, `{"accessToken":"fixture-access","expiresIn":60}`)
		case "/api/v1/vaultix/projects":
			if r.Header.Get("Authorization") != "Bearer fixture-access" {
				w.WriteHeader(401)
				return
			}
			io.WriteString(w, `{"projects":[]}`)
		default:
			w.WriteHeader(500)
		}
	}))
	defer srv.Close()
	file := filepath.Join(home, "credential.json")
	secret := "fixture-client-secret"
	var out strings.Builder
	err := Login(context.Background(), []string{"--api", srv.URL, "--universal", "--credential-file", file}, strings.NewReader("fixture-client\n"+secret+"\n"), &out)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), secret) || strings.Contains(out.String(), "fixture-access") {
		t.Fatal("credential printed")
	}
	if len(paths) != 2 || paths[0] != "/api/v1/auth/universal-auth/login" || paths[1] != "/api/v1/vaultix/projects" {
		t.Fatalf("headless universal login used unexpected paths: %v", paths)
	}
}

func TestConfiguredSsoLoginDoesNotUseBuiltinHeadless(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX credential file tested on Linux; Windows uses the keyring")
	}
	home := t.TempDir()
	os.Chmod(home, 0700)
	t.Setenv("VAULTIX_HOME", home)
	t.Setenv("VAULTIX_TOKEN", "")
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	var issuer *httptest.Server
	var issuerPaths []string
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		issuerPaths = append(issuerPaths, r.URL.Path)
		var data map[string]any
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			data = map[string]any{
				"issuer":                        issuer.URL,
				"device_authorization_endpoint": issuer.URL + "/device",
				"token_endpoint":                issuer.URL + "/token",
			}
		case "/device":
			data = map[string]any{
				"device_code":               "private-device-code",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          issuer.URL + "/activate",
				"verification_uri_complete": issuer.URL + "/activate?user_code=ABCD-EFGH",
				"expires_in":                60,
				"interval":                  1,
			}
		case "/token":
			data = map[string]any{"access_token": "private-access-token", "token_type": "Bearer", "expires_in": 3600}
		default:
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(data)
	}))
	defer issuer.Close()
	var apiPaths []string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiPaths = append(apiPaths, r.URL.Path)
		if r.URL.Path != "/api/v1/vaultix/projects" || r.Header.Get("Authorization") != "Bearer private-access-token" {
			w.WriteHeader(401)
			return
		}
		io.WriteString(w, `{"projects":[]}`)
	}))
	defer api.Close()
	file := filepath.Join(home, "credential.json")
	var out strings.Builder
	err := Login(context.Background(), []string{
		"--api", api.URL,
		"--sso",
		"--issuer", issuer.URL,
		"--client-id", "vaultix-cli",
		"--credential-file", file,
	}, strings.NewReader(""), &out)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "private-access-token") || strings.Contains(out.String(), "private-device-code") {
		t.Fatal("sso credential printed")
	}
	if !strings.Contains(out.String(), "ABCD-EFGH") || !strings.Contains(out.String(), "(nomen)") {
		t.Fatalf("configured sso login did not complete: %s", out.String())
	}
	if strings.Join(issuerPaths, ",") != "/.well-known/openid-configuration,/device,/token" {
		t.Fatalf("issuer paths: %v", issuerPaths)
	}
	if len(apiPaths) != 1 || apiPaths[0] != "/api/v1/vaultix/projects" {
		t.Fatalf("sso login used built-in exchange paths: %v", apiPaths)
	}
}

func TestSsoWithoutIssuerDoesNotUseHostedDefault(t *testing.T) {
	t.Setenv("VAULTIX_HOME", t.TempDir())
	t.Setenv("VAULTIX_TOKEN", "")
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	t.Setenv("NOMEN_OIDC_ISSUER", "")
	t.Setenv("NOMEN_OIDC_CLIENT_ID", "public-client")
	err := Login(context.Background(), []string{"--sso", "--api", "https://vaultix.example"}, strings.NewReader(""), io.Discard)
	if err == nil || !strings.Contains(err.Error(), "NOMEN_OIDC_ISSUER") || strings.Contains(err.Error(), "shippin") {
		t.Fatal(err)
	}
}

func TestLoginDoesNotTrustPublicHealth(t *testing.T) {
	t.Setenv("VAULTIX_HOME", t.TempDir())
	t.Setenv("VAULTIX_TOKEN", "")
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/status" {
			io.WriteString(w, `{"status":"ok"}`)
			return
		}
		w.WriteHeader(401)
		io.WriteString(w, `{"error":"private-token"}`)
	}))
	defer srv.Close()
	var out strings.Builder
	err := Login(context.Background(), []string{"--api", srv.URL, "--token"}, strings.NewReader("private-token\n"), &out)
	if err == nil || strings.Contains(out.String(), "logged in") || strings.Contains(err.Error(), "private-token") {
		t.Fatal("unauthenticated login succeeded or leaked token")
	}
	if _, err := os.Stat(filepath.Join(Dir(), "config.json")); !os.IsNotExist(err) {
		t.Fatal("failed login saved config")
	}
}

func TestCredentialBindingAndExpiry(t *testing.T) {
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	for _, tc := range []struct {
		name string
		c    cred
		pass bool
	}{
		{"bound", cred{Type: "token", Token: "fixture", API: "https://vaultix.example"}, true},
		{"other-instance", cred{Type: "token", Token: "fixture", API: "https://other.example"}, false},
		{"expired", cred{Type: "nomen", Token: "fixture", API: "https://vaultix.example", ExpiresAt: time.Now().Add(-time.Second)}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(tc.c)
			t.Setenv("VAULTIX_TOKEN", string(raw))
			_, err := readCred(&Config{API: "https://vaultix.example/"})
			if (err == nil) != tc.pass {
				t.Fatalf("wrong credential result: %v", err)
			}
		})
	}
}

func TestPrivateHeadlessLoginStatusLogout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX storage tested on Linux; Windows uses the keyring")
	}
	home := t.TempDir()
	os.Chmod(home, 0700)
	t.Setenv("VAULTIX_HOME", home)
	t.Setenv("VAULTIX_TOKEN", "")
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/vaultix/projects" || r.Header.Get("Authorization") != "Bearer private-token" {
			w.WriteHeader(401)
			return
		}
		io.WriteString(w, `{"projects":[]}`)
	}))
	defer srv.Close()
	file := filepath.Join(home, "credential.json")
	var out strings.Builder
	if err := Login(context.Background(), []string{"--api", srv.URL, "--token", "--credential-file", file}, strings.NewReader("private-token\n"), &out); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "private-token") {
		t.Fatal("token printed")
	}
	if err := AuthStatus(context.Background(), &out); err != nil {
		t.Fatal(err)
	}
	cfg, _ := LoadConfig()
	if cfg.CredentialFile != file {
		t.Fatal("credential storage not remembered")
	}
	if err := Logout(); err != nil {
		t.Fatal(err)
	}
	if err := AuthStatus(context.Background(), io.Discard); err == nil {
		t.Fatal("logout did not remove credential")
	}
}

func TestExternalCredentialsAreNotSilentlyOverridden(t *testing.T) {
	t.Setenv("VAULTIX_HOME", t.TempDir())
	t.Setenv("VAULTIX_TOKEN", "fixture")
	if err := Login(context.Background(), []string{"--token"}, strings.NewReader("different\n"), io.Discard); err == nil {
		t.Fatal("external override ignored")
	}
	if err := Logout(); err == nil {
		t.Fatal("reported logout while env credential remains active")
	}
}

func TestMachineSessionReusesTokenButObservesCredentialChange(t *testing.T) {
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	logins := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logins++
		io.WriteString(w, `{"accessToken":"fixture-access","expiresIn":600}`)
	}))
	defer srv.Close()
	credential := cred{Type: "universal", API: srv.URL, ClientID: "fixture", ClientSecret: "one"}
	set := func() { raw, _ := json.Marshal(credential); t.Setenv("VAULTIX_TOKEN", string(raw)) }
	set()
	session := &clientSession{cfg: &Config{API: srv.URL}}
	for i := 0; i < 3; i++ {
		if _, err := session.client(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if logins != 1 {
		t.Fatal("MCP minted a token for every request")
	}
	credential.ClientSecret = "two"
	set()
	if _, err := session.client(context.Background()); err != nil {
		t.Fatal(err)
	}
	if logins != 2 {
		t.Fatal("credential replacement was not observed")
	}
	session.validUntil = time.Now().Add(-time.Second)
	if _, err := session.client(context.Background()); err != nil {
		t.Fatal(err)
	}
	if logins != 3 {
		t.Fatal("expired machine session was not renewed")
	}
}
