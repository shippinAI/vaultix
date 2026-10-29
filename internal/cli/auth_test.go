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
