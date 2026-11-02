package release

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func canonicalFixture(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var ordered map[string]any
	if err = json.Unmarshal(raw, &ordered); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	e := json.NewEncoder(&out)
	e.SetEscapeHTML(false)
	e.SetIndent("", "  ")
	if err = e.Encode(ordered); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

type acquisitionFixture struct {
	options  DownloadOptions
	manifest ReleaseManifest
	listing  downloadListing
	key      ed25519.PrivateKey
	bodies   map[string][]byte
	now      time.Time
	requests []string
	mu       sync.Mutex
	before   func(*http.Request)
	redirect string
}

func newAcquisitionFixture(t *testing.T) *acquisitionFixture {
	t.Helper()
	root := t.TempDir()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(der)
	keyID := hex.EncodeToString(sum[:])
	trust := canonicalFixture(t, map[string]any{"schemaVersion": "vaultix.release-trust.v1", "keys": []any{map[string]any{"keyId": keyID, "publicKey": base64.StdEncoding.EncodeToString(der)}}})
	trustFile := filepath.Join(root, "trust.json")
	if err = os.WriteFile(trustFile, trust, 0600); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	f := &acquisitionFixture{key: key, now: now, bodies: map[string][]byte{}, options: DownloadOptions{Version: "1.2.3", Directory: filepath.Join(root, "bundle"), Trust: trustFile}}
	f.manifest = ReleaseManifest{SchemaVersion: "vaultix.release-manifest.v1", Version: "1.2.3", Channel: "stable", Revision: strings.Repeat("a", 40), Sequence: 12, IssuedAt: now.Add(-time.Minute).Format(time.RFC3339), ExpiresAt: now.Add(time.Hour).Format(time.RFC3339), MinimumUpdaterVersion: "1.0.0", Migration: ReleaseMigration{From: []string{"schema-a"}, To: "schema-a", Rollback: "compatible"}}
	for i, name := range []string{"vaultix-linux-amd64", "vaultixl-linux-amd64", "vaultix-windows-amd64.exe", "vaultixl-windows-amd64.exe", "engine.tar", "source.tar", "sbom.json"} {
		data := []byte("test signed artifact bytes\x00")
		sum := sha256.Sum256(data)
		a := ReleaseArtifact{Name: name, Kind: "cli", Platform: "linux/amd64", Bytes: int64(len(data)), SHA256: hex.EncodeToString(sum[:])}
		if i == 2 || i == 3 {
			a.Platform = "windows/amd64"
		}
		if i == 4 {
			a.Kind = "engine"
			id := "sha256:" + strings.Repeat("b", 64)
			a.ImageID = &id
		}
		if i == 5 {
			a.Kind = "source"
			a.Platform = "any"
		}
		if i == 6 {
			a.Kind = "sbom"
			a.Platform = "any"
		}
		f.manifest.Artifacts = append(f.manifest.Artifacts, a)
		f.bodies[name] = data
	}
	f.sign(t)
	return f
}

func (f *acquisitionFixture) sign(t *testing.T) {
	raw := canonicalFixture(t, f.manifest)
	der, err := x509.MarshalPKIXPublicKey(f.key.Public())
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(der)
	f.bodies["release-manifest.json"] = raw
	f.bodies["release-signature.json"] = canonicalFixture(t, map[string]any{"schemaVersion": "vaultix.release-signature.v1", "keyId": hex.EncodeToString(sum[:]), "signature": base64.StdEncoding.EncodeToString(ed25519.Sign(f.key, raw))})
	no, preview := false, f.options.Preview
	f.listing = downloadListing{Tag: "v" + f.options.Version, Draft: &no, Prerelease: &preview, Published: f.now.Add(-time.Minute).Format(time.RFC3339)}
	names := []string{"release-manifest.json", "release-signature.json"}
	for _, a := range f.manifest.Artifacts {
		names = append(names, a.Name)
	}
	for i, name := range names {
		f.listing.Assets = append(f.listing.Assets, downloadAsset{ID: int64(i + 1), Name: name, Size: int64(len(f.bodies[name])), State: "uploaded", URL: assetOrigin + url.PathEscape(f.listing.Tag) + "/" + url.PathEscape(name)})
	}
}

func (f *acquisitionFixture) transport(t *testing.T) http.RoundTripper {
	return roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.URL.User != nil || r.Body != nil || r.Method != "GET" {
			t.Error("authority leaked into release acquisition")
		}
		f.mu.Lock()
		f.requests = append(f.requests, r.URL.Host+r.URL.Path)
		count := len(f.requests)
		f.mu.Unlock()
		// A broken redirect guard must fail the test, not create an unbounded
		// in-memory redirect loop in this controlled transport.
		if count > 32 {
			return nil, errors.New("fixture request budget exceeded")
		}
		if f.before != nil {
			f.before(r)
		}
		head := make(http.Header)
		var body []byte
		if r.URL.Host == "api.github.com" {
			body = canonicalFixture(t, f.listing)
		} else if f.redirect != "" && r.URL.Host == "github.com" {
			head.Set("Location", f.redirect)
			return &http.Response{StatusCode: 302, Header: head, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		} else {
			body = f.bodies[path.Base(r.URL.Path)]
		}
		return &http.Response{StatusCode: 200, Header: head, ContentLength: int64(len(body)), Body: io.NopCloser(bytes.NewReader(body)), Request: r}, nil
	})
}

func (f *acquisitionFixture) run(t *testing.T) (DownloadResult, error) {
	return download(context.Background(), f.options, f.transport(t), func() time.Time { return f.now })
}

func noPublishedBundle(t *testing.T, f *acquisitionFixture) {
	t.Helper()
	if _, err := os.Lstat(f.options.Directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed acquisition published a destination")
	}
	entries, err := os.ReadDir(filepath.Dir(f.options.Directory))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".vaultix-download-") {
			t.Fatal("normal failure retained staging")
		}
	}
}

func TestDownloadVerifiedBundleAndCheckpoint(t *testing.T) {
	f := newAcquisitionFixture(t)
	checkpoint := ReleaseCheckpoint{SchemaVersion: "vaultix.release-checkpoint.v1", Sequence: 11, SHA256: strings.Repeat("c", 64)}
	f.options.Checkpoint = filepath.Join(filepath.Dir(f.options.Trust), "accepted.json")
	prior := canonicalFixture(t, checkpoint)
	os.WriteFile(f.options.Checkpoint, prior, 0600)
	trust, _ := os.ReadFile(f.options.Trust)
	r, err := f.run(t)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Verified || r.Installed || !r.PriorCheckpointSupplied || r.Artifacts != 7 || r.Version != "1.2.3" || r.Checkpoint.Sequence != 12 {
		t.Fatalf("wrong result: %+v", r)
	}
	if err = VerifyReleaseArtifacts(f.manifest, r.Directory); err != nil {
		t.Fatal(err)
	}
	for _, a := range f.manifest.Artifacts {
		got, err := os.ReadFile(filepath.Join(r.Directory, a.Name))
		if err != nil || !bytes.Equal(got, f.bodies[a.Name]) {
			t.Fatal("downloaded bytes differ")
		}
	}
	current, _ := os.ReadFile(f.options.Checkpoint)
	currentTrust, _ := os.ReadFile(f.options.Trust)
	if !bytes.Equal(current, prior) || !bytes.Equal(currentTrust, trust) {
		t.Fatal("download changed accepted authority")
	}
	if len(f.requests) != 10 {
		t.Fatalf("unexpected requests: %d", len(f.requests))
	}
}

func TestDownloadRefusals(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*acquisitionFixture)
	}{
		{"wrong tag", func(f *acquisitionFixture) { f.listing.Tag = "v9.0.0" }},
		{"draft", func(f *acquisitionFixture) { v := true; f.listing.Draft = &v }},
		{"missing metadata", func(f *acquisitionFixture) { f.listing.Draft = nil }},
		{"incomplete listing", func(f *acquisitionFixture) { f.listing.Assets = f.listing.Assets[:8] }},
		{"foreign asset", func(f *acquisitionFixture) { f.listing.Assets[3].URL = "https://evil.invalid/file" }},
		{"duplicate name", func(f *acquisitionFixture) { f.listing.Assets[3] = f.listing.Assets[2] }},
		{"wrong size", func(f *acquisitionFixture) { f.listing.Assets[3].Size++ }},
		{"bad signature", func(f *acquisitionFixture) { f.bodies["release-signature.json"][10] ^= 1 }},
		{"tampered artifact", func(f *acquisitionFixture) {
			f.bodies["engine.tar"] = bytes.Repeat([]byte{1}, len(f.bodies["engine.tar"]))
		}},
		{"truncated artifact", func(f *acquisitionFixture) { f.bodies["source.tar"] = []byte("short") }},
		{"oversized artifact", func(f *acquisitionFixture) { f.bodies["engine.tar"] = append(f.bodies["engine.tar"], 1) }},
		{"wrong signed version", func(f *acquisitionFixture) { f.manifest.Version = "4.0.0"; f.sign(t) }},
		{"expired", func(f *acquisitionFixture) {
			f.manifest.ExpiresAt = f.now.Add(-time.Second).Format(time.RFC3339)
			f.sign(t)
		}},
		{"signed traversal", func(f *acquisitionFixture) { f.manifest.Artifacts[4].Name = "../engine.tar"; f.sign(t) }},
		{"preview not explicit", func(f *acquisitionFixture) { f.options.Version = "1.2.3-rc.1" }},
		{"replay", func(f *acquisitionFixture) {
			f.options.Checkpoint = filepath.Join(filepath.Dir(f.options.Trust), "checkpoint.json")
			os.WriteFile(f.options.Checkpoint, canonicalFixture(t, ReleaseCheckpoint{SchemaVersion: "vaultix.release-checkpoint.v1", Sequence: 13, SHA256: strings.Repeat("c", 64)}), 0600)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newAcquisitionFixture(t)
			test.change(f)
			if _, err := f.run(t); err == nil {
				t.Fatal("unsafe acquisition accepted")
			}
			noPublishedBundle(t, f)
		})
	}
}

func TestDownloadExistingAndRacingDestination(t *testing.T) {
	for _, racing := range []bool{false, true} {
		t.Run(map[bool]string{false: "existing", true: "created during transfer"}[racing], func(t *testing.T) {
			f := newAcquisitionFixture(t)
			create := func() {
				if err := os.Mkdir(f.options.Directory, 0700); err != nil {
					t.Fatal(err)
				}
				os.WriteFile(filepath.Join(f.options.Directory, "retain"), []byte("existing release"), 0600)
			}
			if racing {
				f.before = func(r *http.Request) {
					if path.Base(r.URL.Path) == "engine.tar" {
						create()
					}
				}
			} else {
				create()
			}
			if _, err := f.run(t); err == nil {
				t.Fatal("replaced destination")
			}
			raw, err := os.ReadFile(filepath.Join(f.options.Directory, "retain"))
			if err != nil || string(raw) != "existing release" {
				t.Fatal("existing destination changed")
			}
		})
	}
	// Even an empty competing destination must survive: ordinary Unix rename
	// would replace it, so this independently challenges RENAME_NOREPLACE.
	f := newAcquisitionFixture(t)
	f.before = func(r *http.Request) {
		if path.Base(r.URL.Path) == "engine.tar" {
			if err := os.Mkdir(f.options.Directory, 0700); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := f.run(t); err == nil {
		t.Fatal("replaced empty racing destination")
	}
	entries, err := os.ReadDir(f.options.Directory)
	if err != nil || len(entries) != 0 {
		t.Fatal("empty competing destination altered")
	}
}

func TestDownloadCancellationAndExpiredDuringTransfer(t *testing.T) {
	for _, expire := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "expiry"}[expire], func(t *testing.T) {
			f := newAcquisitionFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			f.before = func(r *http.Request) {
				if path.Base(r.URL.Path) == "engine.tar" {
					if expire {
						f.now = f.now.Add(2 * time.Hour)
					} else {
						cancel()
					}
				}
			}
			if _, err := download(ctx, f.options, f.transport(t), func() time.Time { return f.now }); err == nil {
				t.Fatal("cancelled or expired download published")
			}
			noPublishedBundle(t, f)
		})
	}
}

func TestDownloadRedirectPolicy(t *testing.T) {
	for _, location := range []string{"http://release-assets.githubusercontent.com/a", "https://evil.invalid/a", "https://release-assets.githubusercontent.com:443/a", "https://user:secret@release-assets.githubusercontent.com/a", "https://github.com/login", "https://api.github.com/a", "https://objects.githubusercontent.com/a#fragment"} {
		t.Run(location, func(t *testing.T) {
			f := newAcquisitionFixture(t)
			f.redirect = location
			if _, err := f.run(t); err == nil {
				t.Fatal("unsafe redirect accepted")
			}
			if len(f.requests) != 2 {
				t.Fatal("redirect reached refused destination")
			}
			noPublishedBundle(t, f)
		})
	}
	for _, host := range []string{"release-assets.githubusercontent.com", "objects.githubusercontent.com"} {
		req, _ := http.NewRequest("GET", "https://"+host+"/asset?signed=opaque", nil)
		req.Header.Set("Authorization", "canary")
		req.Header.Set("Cookie", "canary")
		initial, _ := http.NewRequest("GET", assetOrigin+"v1.2.3/source.tar", nil)
		if err := downloadRedirect(req, []*http.Request{initial}); err != nil {
			t.Fatal(err)
		}
		if req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
			t.Fatal("redirect retained authority")
		}
		if downloadRedirect(req, []*http.Request{initial, initial, initial, initial}) == nil {
			t.Fatal("unbounded redirect chain")
		}
	}
}

func TestDownloadTransferErrorsAreBoundedAndRedacted(t *testing.T) {
	for _, transport := range []http.RoundTripper{
		roundTrip(func(*http.Request) (*http.Response, error) { return nil, errors.New("private-canary") }),
		roundTrip(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 503, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("private-canary")), Request: r}, nil
		}),
		roundTrip(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Header: make(http.Header), ContentLength: -1, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", 100))), Request: r}, nil
		}),
	} {
		var b bytes.Buffer
		n, err := downloadBody(context.Background(), transport, releaseAPI+"v1.2.3", true, 20, &b)
		if err == nil || strings.Contains(err.Error(), "private-canary") || n > 21 || b.Len() > 21 {
			t.Fatal("transfer boundary failed")
		}
	}
}

func TestDownloadConcurrentPublication(t *testing.T) {
	f := newAcquisitionFixture(t)
	results := make(chan error, 2)
	for range 2 {
		go func() { _, err := f.run(t); results <- err }()
	}
	first, second := <-results, <-results
	if (first == nil) == (second == nil) {
		t.Fatal("exactly one concurrent publication must succeed")
	}
	if err := VerifyReleaseArtifacts(f.manifest, f.options.Directory); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Dir(f.options.Directory))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".vaultix-download-") {
			t.Fatal("concurrent operation retained staging")
		}
	}
}
