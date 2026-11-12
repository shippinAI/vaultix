package nomen

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const tokenCanary = "opaque-access-credential-canary"

type fixture struct {
	server *httptest.Server
	deps   *VerifierDeps
	logs   bytes.Buffer
	posts  atomic.Int32
}

func newFixture(t *testing.T, handler func(http.ResponseWriter, *http.Request, map[string]any)) *fixture {
	t.Helper()
	f := &fixture{}
	f.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/.well-known/openid-configuration" {
			if r.Method != http.MethodGet || r.Header.Get("Authorization") != "" {
				t.Error("discovery must be a public metadata read")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": f.server.URL,
				"introspection_endpoint":                        f.server.URL + "/introspect",
				"introspection_endpoint_auth_methods_supported": []string{"private_key_jwt", "client_secret_basic"}})
			return
		}
		if r.URL.Path != "/introspect" || r.Method != http.MethodPost || r.ParseForm() != nil {
			t.Error("invalid introspection request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.posts.Add(1)
		if r.Form.Get("token") != tokenCanary || r.Form.Get("token_type_hint") != "access_token" || r.URL.RawQuery != "" {
			t.Error("token must be sent only in the intended POST body")
		}
		claims := map[string]any{"active": true, "iss": f.server.URL, "sub": "human-123", "aud": []string{"vaultix-resource"},
			"client_id": "public-cli", "token_type": "Bearer", "scope": "openid profile",
			"iat": time.Now().Add(-time.Minute).Unix(), "exp": time.Now().Add(10 * time.Minute).Unix()}
		handler(w, r, claims)
	}))
	t.Cleanup(f.server.Close)
	f.deps = &VerifierDeps{Config: Config{Issuer: f.server.URL, Endpoint: f.server.URL + "/introspect", Audience: "vaultix-resource",
		AllowedClientIDs: []string{"public-cli"}, RequiredScopes: []string{"openid"}}, HTTPClient: f.server.Client(),
		Credentials: ClientCredentials{Method: ClientSecretBasic, ClientID: "api:reader", Secret: "secret+:/ credential-canary"}}
	return f
}

func (f *fixture) verifier(t *testing.T) *Verifier {
	t.Helper()
	v, err := NewVerifier(context.Background(), slog.New(slog.NewTextHandler(&f.logs, &slog.HandlerOptions{Level: slog.LevelDebug})), f.deps)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestIntrospect_BasicAndImmutableConfiguration(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request, claims map[string]any) {
		id, secret, ok := r.BasicAuth()
		decodedID, _ := url.QueryUnescape(id)
		decodedSecret, _ := url.QueryUnescape(secret)
		if !ok || decodedID != "api:reader" || decodedSecret != "secret+:/ credential-canary" {
			t.Error("OAuth Basic credentials were not form-encoded")
		}
		claims["aud"] = "vaultix-resource"
		claims["unrelated_provider_extension"] = map[string]any{"ignored": true}
		_ = json.NewEncoder(w).Encode(claims)
	})
	v := f.verifier(t)
	f.deps.Config.AllowedClientIDs[0] = "other-client"
	f.deps.Config.RequiredScopes[0] = "other-scope"
	f.deps.Credentials.Secret = "changed-after-construction"
	claims, err := v.Introspect(context.Background(), tokenCanary)
	if err != nil || claims.Subject != "human-123" || claims.Issuer != f.server.URL || claims.ClientID != "public-cli" {
		t.Fatal("valid pinned profile did not produce expected metadata")
	}
	if f.posts.Load() != 1 || strings.Contains(f.logs.String(), tokenCanary) || strings.Contains(f.logs.String(), "credential-canary") {
		t.Fatal("unexpected requests or credential disclosure")
	}
}

func TestIntrospect_PrivateKeyJWT(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	var previousID string
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request, claims map[string]any) {
		if r.Header.Get("Authorization") != "" || r.Form.Get("client_assertion_type") != "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" {
			t.Error("private-key introspection used an unexpected authentication method")
		}
		var assertion jwt.RegisteredClaims
		parsed, err := jwt.ParseWithClaims(r.Form.Get("client_assertion"), &assertion, func(token *jwt.Token) (any, error) {
			if token.Header["kid"] != "registered-key" {
				t.Error("registered signing key ID missing")
			}
			return &key.PublicKey, nil
		}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer("resource-api"), jwt.WithSubject("resource-api"), jwt.WithAudience(issuer), jwt.WithExpirationRequired())
		if err != nil || !parsed.Valid || assertion.ID == "" || assertion.ID == previousID || assertion.ExpiresAt.Sub(assertion.IssuedAt.Time) != time.Minute {
			t.Error("invalid signature, recipient, lifetime or assertion replay identifier")
		}
		previousID = assertion.ID
		_ = json.NewEncoder(w).Encode(claims)
	})
	issuer = f.server.URL
	f.deps.Credentials = ClientCredentials{Method: PrivateKeyJWT, ClientID: "resource-api", KeyID: "registered-key", Signer: key}
	v := f.verifier(t)
	for range 2 {
		if _, err := v.Introspect(context.Background(), tokenCanary); err != nil {
			t.Fatal(err)
		}
	}
	if f.posts.Load() != 2 {
		t.Fatal("each call must introspect with a fresh assertion")
	}
}

func TestIntrospect_RejectsInvalidClaims(t *testing.T) {
	for name, change := range map[string]func(map[string]any){
		"inactive":               func(c map[string]any) { c["active"] = false },
		"missing-active":         func(c map[string]any) { delete(c, "active") },
		"string-active":          func(c map[string]any) { c["active"] = "true" },
		"wrong-issuer":           func(c map[string]any) { c["iss"] = "https://other.example" },
		"wrong-audience":         func(c map[string]any) { c["aud"] = []string{"another-api"} },
		"null-audience":          func(c map[string]any) { c["aud"] = nil },
		"malformed-audience":     func(c map[string]any) { c["aud"] = []any{nil, "vaultix-resource"} },
		"unapproved-client":      func(c map[string]any) { c["client_id"] = "unapproved" },
		"empty-subject":          func(c map[string]any) { c["sub"] = "" },
		"missing-subject":        func(c map[string]any) { delete(c, "sub") },
		"control-subject":        func(c map[string]any) { c["sub"] = "human\n123" },
		"expired":                func(c map[string]any) { c["exp"] = time.Now().Add(-time.Second).Unix() },
		"null-expiry":            func(c map[string]any) { c["exp"] = nil },
		"string-expiry":          func(c map[string]any) { c["exp"] = "9999999999" },
		"fractional-expiry":      func(c map[string]any) { c["exp"] = 9999999999.5 },
		"huge-expiry":            func(c map[string]any) { c["exp"] = json.Number("9223372036854775807") },
		"missing-issued":         func(c map[string]any) { delete(c, "iat") },
		"future-issued":          func(c map[string]any) { c["iat"] = time.Now().Add(time.Hour).Unix() },
		"future-not-before":      func(c map[string]any) { c["nbf"] = time.Now().Add(time.Hour).Unix() },
		"null-not-before":        func(c map[string]any) { c["nbf"] = nil },
		"invalid-interval":       func(c map[string]any) { c["iat"] = c["exp"] },
		"id-token-type":          func(c map[string]any) { c["token_type"] = "id_token" },
		"missing-token-type":     func(c map[string]any) { delete(c, "token_type") },
		"missing-required-scope": func(c map[string]any) { c["scope"] = "profile" },
		"control-scope":          func(c map[string]any) { c["scope"] = "openid\nprofile" },
		"array-scope":            func(c map[string]any) { c["scope"] = []string{"openid"} },
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t, func(w http.ResponseWriter, _ *http.Request, claims map[string]any) {
				change(claims)
				_ = json.NewEncoder(w).Encode(claims)
			})
			if claims, err := f.verifier(t).Introspect(context.Background(), tokenCanary); err == nil || claims != nil {
				t.Fatal("invalid provider claims were accepted")
			}
		})
	}
}

func TestIntrospect_ProtocolFailureAndRecovery(t *testing.T) {
	var mode atomic.Int32
	var redirected atomic.Int32
	target := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
	defer target.Close()
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request, claims map[string]any) {
		switch mode.Load() {
		case 1:
			http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
		case 2:
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, tokenCanary)
		case 3:
			_, _ = io.WriteString(w, strings.Repeat(" ", maxResponseBytes+1))
		case 4:
			_, _ = io.WriteString(w, `{"active":false,"active":true}`)
		case 5:
			_, _ = io.WriteString(w, `{"active":false} {"active":true}`)
		case 6:
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, tokenCanary)
		case 7:
			<-r.Context().Done()
		case 8:
			_ = json.NewEncoder(w).Encode(map[string]any{"active": false})
		default:
			_ = json.NewEncoder(w).Encode(claims)
		}
	})
	v := f.verifier(t)
	for _, state := range []int32{1, 2, 3, 4, 5, 6, 7, 8} {
		mode.Store(state)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		claims, err := v.Introspect(ctx, tokenCanary)
		cancel()
		if err == nil || claims != nil || strings.Contains(err.Error(), tokenCanary) {
			t.Fatal("unsafe protocol failure or disclosure")
		}
		if state != 8 && !errors.Is(err, ErrUnavailable) {
			t.Fatal("provider failure must remain distinguishable from invalid credentials")
		}
		mode.Store(0)
		if _, err := v.Introspect(context.Background(), tokenCanary); err != nil {
			t.Fatal("healthy issuer did not recover after failure")
		}
	}
	if redirected.Load() != 0 || f.posts.Load() != 16 {
		t.Fatal("redirect followed or token introspection cached")
	}
	if strings.Contains(f.logs.String(), tokenCanary) {
		t.Fatal("provider response escaped into logs")
	}
}

func TestNewVerifier_RejectsUnsafeConfiguration(t *testing.T) {
	for name, change := range map[string]func(*VerifierDeps){
		"http":              func(d *VerifierDeps) { d.Config.Issuer = "http://127.0.0.1" },
		"user-info":         func(d *VerifierDeps) { d.Config.Issuer = "https://credential-canary@example.test" },
		"query":             func(d *VerifierDeps) { d.Config.Endpoint += "?" },
		"fragment":          func(d *VerifierDeps) { d.Config.Endpoint += "#" },
		"different-origin":  func(d *VerifierDeps) { d.Config.Endpoint = "https://other.example/introspect" },
		"missing-audience":  func(d *VerifierDeps) { d.Config.Audience = "" },
		"no-clients":        func(d *VerifierDeps) { d.Config.AllowedClientIDs = nil },
		"duplicate-clients": func(d *VerifierDeps) { d.Config.AllowedClientIDs = []string{"same", "same"} },
		"no-scopes":         func(d *VerifierDeps) { d.Config.RequiredScopes = nil },
		"invalid-scope":     func(d *VerifierDeps) { d.Config.RequiredScopes = []string{"bad scope"} },
		"no-credentials":    func(d *VerifierDeps) { d.Credentials = ClientCredentials{} },
		"missing-signer": func(d *VerifierDeps) {
			d.Credentials = ClientCredentials{Method: PrivateKeyJWT, ClientID: "api", KeyID: "key"}
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t, func(http.ResponseWriter, *http.Request, map[string]any) {
				t.Error("invalid config reached introspection")
			})
			change(f.deps)
			if _, err := NewVerifier(context.Background(), slog.New(slog.DiscardHandler), f.deps); !errors.Is(err, ErrConfiguration) {
				t.Fatal("unsafe config was not rejected")
			}
		})
	}
}

func TestIntrospect_CancellationAndConcurrentRequests(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, _ *http.Request, claims map[string]any) {
		_ = json.NewEncoder(w).Encode(claims)
	})
	v := f.verifier(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := v.Introspect(ctx, tokenCanary); !errors.Is(err, ErrUnavailable) || f.posts.Load() != 0 {
		t.Fatal("canceled request reached the issuer")
	}
	for _, bad := range []string{"", "token\ncanary", strings.Repeat("a", maxTokenBytes+1)} {
		if _, err := v.Introspect(context.Background(), bad); !errors.Is(err, ErrInvalidToken) || f.posts.Load() != 0 {
			t.Fatal("invalid input reached the issuer")
		}
	}
	var group sync.WaitGroup
	for range 12 {
		group.Go(func() {
			if _, err := v.Introspect(context.Background(), tokenCanary); err != nil {
				t.Error("concurrent introspection failed")
			}
		})
	}
	group.Wait()
	if f.posts.Load() != 12 {
		t.Fatal("requests were cached or lost")
	}
}

func TestClientCredentials_RedactedFormatting(t *testing.T) {
	c := ClientCredentials{Method: ClientSecretBasic, ClientID: "api", Secret: tokenCanary}
	encoded, err := json.Marshal(c)
	if err != nil || string(encoded) != "{}" || strings.Contains(fmt.Sprintf("%v %+v %#v", c, c, c), tokenCanary) {
		t.Fatal("resource credentials disclosed through formatting")
	}
}

func TestNewVerifier_DiscoveryCannotRedirectAuthority(t *testing.T) {
	for _, scenario := range []string{"issuer", "endpoint", "method", "duplicate", "redirect"} {
		t.Run(scenario, func(t *testing.T) {
			var calls atomic.Int32
			var origin string
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" || r.Method != http.MethodGet {
					t.Error("credentials sent before pinned discovery was validated")
				}
				w.Header().Set("Content-Type", "application/json")
				metadata := map[string]any{"issuer": origin, "introspection_endpoint": origin + "/introspect",
					"introspection_endpoint_auth_methods_supported": []string{"client_secret_basic"}}
				switch scenario {
				case "issuer":
					metadata["issuer"] = "https://different.example"
				case "endpoint":
					metadata["introspection_endpoint"] = origin + "/different"
				case "method":
					metadata["introspection_endpoint_auth_methods_supported"] = []string{"none"}
				case "duplicate":
					_, _ = io.WriteString(w, `{"issuer":"one","issuer":"two"}`)
					return
				case "redirect":
					http.Redirect(w, r, origin+"/different", http.StatusTemporaryRedirect)
					return
				}
				_ = json.NewEncoder(w).Encode(metadata)
			}))
			defer server.Close()
			origin = server.URL
			deps := &VerifierDeps{Config: Config{Issuer: origin, Endpoint: origin + "/introspect", Audience: "resource",
				AllowedClientIDs: []string{"public-cli"}, RequiredScopes: []string{"openid"}}, HTTPClient: server.Client(),
				Credentials: ClientCredentials{Method: ClientSecretBasic, ClientID: "resource", Secret: tokenCanary}}
			if v, err := NewVerifier(context.Background(), slog.New(slog.DiscardHandler), deps); err == nil || v != nil || calls.Load() != 1 {
				t.Fatal("untrusted discovery changed authority or followed a redirect")
			}
		})
	}
}

func TestClientCredentials_TypedNilSigner(t *testing.T) {
	var key *rsa.PrivateKey
	c := ClientCredentials{Method: PrivateKeyJWT, ClientID: "api", KeyID: "key", Signer: key}
	if !errors.Is(c.validate(), ErrConfiguration) {
		t.Fatal("typed nil signer was not rejected")
	}
}

func TestIntrospect_SubjectMustRemainExactASCII(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, _ *http.Request, claims map[string]any) {
		claims["sub"] = "\ufffd"
		_ = json.NewEncoder(w).Encode(claims)
	})
	if claims, err := f.verifier(t).Introspect(context.Background(), tokenCanary); err == nil || claims != nil {
		t.Fatal("a normalized/non-ASCII subject was accepted as an identity key")
	}
}

type closeFailureBody struct{ io.ReadCloser }

func (b closeFailureBody) Close() error {
	if err := b.ReadCloser.Close(); err != nil {
		return err
	}
	return errors.New("fixture transport cleanup failure")
}

type closeFailureTransport struct {
	base http.RoundTripper
	fail atomic.Bool
}

func (t *closeFailureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(request)
	if err == nil && t.fail.Load() {
		response.Body = closeFailureBody{response.Body}
	}
	return response, err
}

func TestIntrospect_TransportCloseFailureAndRecovery(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, _ *http.Request, claims map[string]any) {
		_ = json.NewEncoder(w).Encode(claims)
	})
	transport := &closeFailureTransport{base: f.deps.HTTPClient.Transport}
	f.deps.HTTPClient.Transport = transport
	v := f.verifier(t)
	transport.fail.Store(true)
	if claims, err := v.Introspect(context.Background(), tokenCanary); claims != nil || !errors.Is(err, ErrUnavailable) {
		t.Fatal("transport cleanup failure yielded authenticated claims")
	}
	transport.fail.Store(false)
	if _, err := v.Introspect(context.Background(), tokenCanary); err != nil {
		t.Fatal("transport did not recover")
	}
}
