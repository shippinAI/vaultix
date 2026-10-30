package cli

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zalando/go-keyring"
	"shippin.cloud/vaultix/internal/store"
)

func renewalFixture(t *testing.T, reject bool) (*Config, *cred, *atomic.Int32) {
	t.Helper()
	home := t.TempDir()
	os.Chmod(home, 0700)
	t.Setenv("VAULTIX_HOME", home)
	t.Setenv("VAULTIX_TOKEN", "")
	t.Setenv("VAULTIX_TOKEN_FILE", "")
	t.Setenv("APPDATA", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	calls := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			calls.Add(1)
			if r.FormValue("refresh_token") != "private-refresh" || r.FormValue("client_id") != "public-cli" {
				t.Error("saved credential binding lost")
			}
			if reject {
				w.WriteHeader(400)
				io.WriteString(w, `{"error":"invalid_grant","error_description":"private-refresh"}`)
				return
			}
			io.WriteString(w, `{"access_token":"private-renewed","refresh_token":"private-rotated","token_type":"Bearer","expires_in":3600}`)
		case "/api/v1/vaultix/projects":
			if r.Header.Get("Authorization") != "Bearer private-renewed" {
				w.WriteHeader(401)
				return
			}
			io.WriteString(w, `{"projects":[]}`)
		default:
			t.Error("unexpected credential destination")
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	cfg := &Config{API: srv.URL}
	if runtime.GOOS == "windows" {
		keyring.MockInit()
	} else {
		cfg.CredentialFile = filepath.Join(home, "credential.json")
	}
	c := &cred{Type: "nomen", API: srv.URL, Issuer: srv.URL, ClientID: "public-cli", TokenEndpoint: srv.URL + "/token", Token: "private-old", RefreshToken: "private-refresh", ExpiresAt: time.Now().Add(-time.Second)}
	if err := saveCred(cfg, c); err != nil {
		t.Fatal(err)
	}
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	return cfg, c, calls
}

func TestSavedNomenRotationAndLogout(t *testing.T) {
	cfg, _, calls := renewalFixture(t, false)
	// Environment changes cannot change the saved issuer/client binding.
	t.Setenv("NOMEN_OIDC_ISSUER", "https://wrong.example")
	t.Setenv("NOMEN_OIDC_CLIENT_ID", "wrong")
	var output strings.Builder
	for i := 0; i < 2; i++ {
		if err := AuthStatus(context.Background(), &output); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 || strings.Contains(output.String(), "private-") {
		t.Fatal("rotation repeated or disclosed")
	}
	c, err := readCred(cfg)
	if err != nil || c.RefreshPending || c.RefreshToken != "private-rotated" || c.Token != "private-renewed" || time.Until(c.ExpiresAt) < 59*time.Minute {
		t.Fatal("rotation not saved")
	}
	if err := Logout(); err != nil {
		t.Fatal(err)
	}
	if _, err := authenticatedClient(context.Background(), cfg); err == nil {
		t.Fatal("logout revived credential")
	}
}

func TestRenewalFailureIsNotReplayed(t *testing.T) {
	for _, reason := range []string{"issuer-rejected", "interrupted", "api-denied"} {
		t.Run(reason, func(t *testing.T) {
			cfg, c, calls := renewalFixture(t, reason == "issuer-rejected")
			if reason == "interrupted" {
				c.RefreshPending = true
				if err := saveCred(cfg, c); err != nil {
					t.Fatal(err)
				}
			}
			if reason == "api-denied" {
				api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(403)
					io.WriteString(w, `{"error":"private-renewed"}`)
				}))
				defer api.Close()
				cfg.API = api.URL
				c.API = api.URL
				if err := saveCred(cfg, c); err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < 2; i++ {
				_, err := authenticatedClient(context.Background(), cfg)
				if err == nil || strings.Contains(err.Error(), "private-") {
					t.Fatal("failed renewal accepted or disclosed")
				}
			}
			want := int32(1)
			if reason == "interrupted" {
				want = 0
			}
			if calls.Load() != want {
				t.Fatal("consumed refresh token replayed")
			}
			stored, err := readCred(cfg)
			if err != nil || !stored.RefreshPending || stored.Token != "private-old" {
				t.Fatal("unsafe recovery state")
			}
		})
	}
}

func TestExternalAndOtherInstanceCredentialsNeverRenew(t *testing.T) {
	for _, mode := range []string{"environment", "file-override", "other-instance", "missing-binding"} {
		t.Run(mode, func(t *testing.T) {
			cfg, c, calls := renewalFixture(t, false)
			raw, _ := json.Marshal(c)
			switch mode {
			case "environment":
				t.Setenv("VAULTIX_TOKEN", string(raw))
			case "file-override":
				path := filepath.Join(t.TempDir(), "external")
				os.WriteFile(path, raw, 0600)
				t.Setenv("VAULTIX_TOKEN_FILE", path)
			case "other-instance":
				cfg.API = "https://other.example"
			case "missing-binding":
				c.Issuer = ""
				saveCred(cfg, c)
			}
			if _, err := authenticatedClient(context.Background(), cfg); err == nil {
				t.Fatal("unrenewable expired credential accepted")
			}
			if calls.Load() != 0 {
				t.Fatal("external/other-instance credential renewed")
			}
		})
	}
}

func TestConcurrentRenewalConsumesRefreshOnce(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX file integration; Windows OS lock has separate process tests")
	}
	cfg, _, calls := renewalFixture(t, false)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := authenticatedClient(context.Background(), cfg); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("concurrent processes replayed refresh token")
	}
}

func TestRenewalRereadsCredentialAfterWaiting(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX credential file concurrency")
	}
	for _, operation := range []string{"logout", "replace"} {
		t.Run(operation, func(t *testing.T) {
			cfg, _, calls := renewalFixture(t, false)
			var done chan error
			if err := store.WithCredentialLock(context.Background(), cfg.CredentialFile, func() error {
				done = make(chan error, 1)
				go func() { _, err := (&clientSession{cfg: cfg}).renewNomen(context.Background()); done <- err }()
				if operation == "logout" {
					return store.ForgetCredentialFile(cfg.CredentialFile)
				}
				return saveCred(cfg, &cred{Type: "token", API: cfg.API, Token: "private-replacement"})
			}); err != nil {
				t.Fatal(err)
			}
			err := <-done
			if (err == nil) != (operation == "replace") {
				t.Fatal("replacement/logout not observed")
			}
			if calls.Load() != 0 {
				t.Fatal("old credential renewed after replacement/logout")
			}
		})
	}
}

func TestCancelledRenewalDoesNotConsumeCredential(t *testing.T) {
	cfg, _, calls := renewalFixture(t, false)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := authenticatedClient(ctx, cfg); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	c, err := readCred(cfg)
	if err != nil || c.RefreshPending || calls.Load() != 0 {
		t.Fatal("canceled operation consumed credential")
	}
}

func TestRenewalMarginRespectsShortLifetimes(t *testing.T) {
	now := time.Now()
	expires := now.Add(2 * time.Second)
	at := refreshAfter(expires)
	if !at.After(now.Add(time.Second)) || !at.Before(expires) {
		t.Fatal("short-lived token renews immediately or after expiry")
	}
}
