package console

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"shippin.cloud/vaultix/internal/platform"
	"shippin.cloud/vaultix/platform/shippin/fleet"
)

func setup(t *testing.T) (http.Handler, string, string) {
	t.Helper()
	control, directory := t.TempDir(), t.TempDir()
	f, err := fleet.Open(control, func(_ context.Context, _ string, o platform.Options, _ io.Writer) (platform.Result, error) {
		if o.Directory != directory {
			return platform.Result{}, errors.New("instance not enrolled")
		}
		return platform.Result{Ready: true, SetupCode: "vxs-secret", Instance: platform.Instance{SiteURL: "https://acme.vaultix.cloud"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	key, path, err := OperatorKey(control)
	if err != nil || !strings.HasPrefix(key, "vxc-") || filepath.Dir(path) != control {
		t.Fatalf("key %q at %q: %v", key, path, err)
	}
	again, _, _ := OperatorKey(control)
	if again != key {
		t.Fatal("the operator key changed between starts")
	}
	return New(f, key).Handler(), key, directory
}

func TestEverythingNeedsTheOperatorKey(t *testing.T) {
	h, key, _ := setup(t)
	for _, r := range []*http.Request{
		httptest.NewRequest("GET", "/api/fleet", nil),
		httptest.NewRequest("POST", "/api/fleet/instances", strings.NewReader(`{}`)),
	} {
		r.Header.Set("Authorization", "Bearer vxc-wrong")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"error"`) {
			t.Fatalf("%s %s: %d %s", r.Method, r.URL, w.Code, w.Body)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if !strings.Contains(w.Body.String(), "Sign in") || strings.Contains(w.Body.String(), key) {
		t.Fatal("the signed-out page must ask for the key and never contain it")
	}
}

func TestOperatorEnrollsAndSeesHealthWithoutCodes(t *testing.T) {
	h, key, directory := setup(t)
	form := url.Values{"key": {key}}
	r := httptest.NewRequest("POST", "/login", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	cookies := w.Result().Cookies()
	if w.Code != http.StatusSeeOther || len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("login: %d %+v", w.Code, cookies)
	}

	r = httptest.NewRequest("POST", "/api/fleet/instances", strings.NewReader(`{"label":"acme","customer":"Acme","profile":"team","directory":`+jsonString(directory)+`}`))
	r.Header.Set("Authorization", "Bearer "+key)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("enroll: %d %s", w.Code, w.Body)
	}

	r = httptest.NewRequest("GET", "/", nil)
	r.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	body := w.Body.String()
	if !strings.Contains(body, "acme") || !strings.Contains(body, "Ready") || strings.Contains(body, "vxs-") {
		t.Fatalf("fleet page missing the instance or showing a code:\n%s", body)
	}
	if w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("console pages must not be cached or framed")
	}

	r = httptest.NewRequest("POST", "/fleet/instances", strings.NewReader("label=evil&customer=x&profile=team&directory=x"))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	r.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("cross-site form accepted: %d", w.Code)
	}
}

func TestOnlyLoopbackListens(t *testing.T) {
	for address, ok := range map[string]bool{"127.0.0.1:8300": true, "[::1]:8300": true, "0.0.0.0:8300": false, "10.0.0.5:8300": false, "localhost:8300": false} {
		if (RequireLoopback(address) == nil) != ok {
			t.Fatalf("%s: loopback=%v", address, ok)
		}
	}
}

func jsonString(s string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
}

func TestMain(m *testing.M) { os.Exit(m.Run()) }
