package release

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSemanticOrdering(t *testing.T) {
	ordered := []string{"1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"}
	for i, a := range ordered {
		for k, b := range ordered {
			av, ok := Parse(a)
			if !ok {
				t.Fatal(a)
			}
			bv, ok := Parse(b)
			if !ok {
				t.Fatal(b)
			}
			c := Compare(av, bv)
			if (i < k && c >= 0) || (i == k && c != 0) || (i > k && c <= 0) {
				t.Fatalf("incorrect order %s %s", a, b)
			}
		}
	}
	for _, s := range []string{"1.02.0", "01.2.0", "1.2.3-01", "1.2.3-", "1.2.3+", "1.2.3-rc..1", "latest", "dev", "1.2.3/evil", "1.2.3\x1b"} {
		if _, ok := Parse(s); ok {
			t.Fatalf("accepted %q", s)
		}
	}
	a, _ := Parse("v1.2.3+build.1")
	b, _ := Parse("1.2.3+build.2")
	if Compare(a, b) != 0 {
		t.Fatal("build metadata changed precedence")
	}
}

func TestReleaseBoundary(t *testing.T) {
	good := `{"tag_name":"v1.2.3","draft":false,"prerelease":false,"published_at":"2026-10-31T12:00:00Z","html_url":"https://untrusted.invalid/"}`
	for _, test := range []struct {
		name    string
		code    int
		body    string
		current string
		state   string
		failure bool
	}{
		{"newer", 200, good, "1.2.2", "available", false},
		{"stable after rc", 200, good, "1.2.3-rc.1", "available", false},
		{"equal", 200, good, "1.2.3", "current", false},
		{"older feed", 200, good, "2.0.0", "current", false},
		{"not found", 404, "{}", "1.2.3", "unpublished", false},
		{"rate limited", 429, "CANARY-SENSITIVE", "1.2.3", "unavailable", true},
		{"redirect", 302, "{}", "1.2.3", "unavailable", true},
		{"draft", 200, strings.Replace(good, `"draft":false`, `"draft":true`, 1), "1.2.3", "unavailable", true},
		{"missing metadata", 200, `{"tag_name":"v3.0.0"}`, "1.2.3", "unavailable", true},
		{"prerelease", 200, strings.Replace(good, "v1.2.3", "v3.0.0-rc.1", 1), "1.2.3", "unavailable", true},
		{"too large", 200, strings.Repeat("x", 65537), "1.2.3", "unavailable", true},
		{"malformed", 200, "CANARY-SENSITIVE", "1.2.3", "unavailable", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := NewClient()
			client.HTTP.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() != LatestURL || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Body != nil {
					t.Fatal("unexpected authority in release request")
				}
				return &http.Response{StatusCode: test.code, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(test.body))}, nil
			})
			status, err := client.Check(context.Background(), test.current)
			if (err != nil) != test.failure || status.State != test.state {
				t.Fatalf("state=%s err=%v", status.State, err)
			}
			if err != nil && strings.Contains(err.Error(), "CANARY") {
				t.Fatal("response leaked")
			}
			if !strings.HasPrefix(status.ReleaseURL, ReleasesURL) {
				t.Fatal("untrusted release destination")
			}
		})
	}
}

func TestDevelopmentAndUnavailable(t *testing.T) {
	calls := 0
	client := NewClient()
	client.HTTP.Transport = roundTrip(func(*http.Request) (*http.Response, error) { calls++; return nil, errors.New("CANARY-SENSITIVE") })
	status, err := client.Check(context.Background(), "dev")
	if err != nil || status.State != "development" || calls != 0 {
		t.Fatal("development build performed a release lookup")
	}
	status, err = client.Check(context.Background(), "1.0.0")
	if err == nil || status.State != "unavailable" || strings.Contains(err.Error(), "CANARY") {
		t.Fatal("unsafe unavailable state")
	}
	if client.HTTP.Timeout <= 0 || client.HTTP.CheckRedirect == nil {
		t.Fatal("unbounded release client")
	}
}
