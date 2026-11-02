package release

// Acquisition is separate from installation. This client never loads a CLI
// credential, adopts downloaded trust, executes an artifact or advances the
// caller's accepted-release checkpoint.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const releaseAPI = "https://api.github.com/repos/shippinAI/vaultix/releases/tags/"
const assetOrigin = "https://github.com/shippinAI/vaultix/releases/download/"
const maxDownloadBytes int64 = 64 << 30

type DownloadOptions struct {
	Version, Directory, Trust, Checkpoint string
	Preview                               bool
	Progress                              io.Writer
}

type DownloadResult struct {
	SchemaVersion           string            `json:"schemaVersion"`
	Directory               string            `json:"directory"`
	Version                 string            `json:"version"`
	Revision                string            `json:"revision"`
	Checkpoint              ReleaseCheckpoint `json:"checkpoint"`
	PriorCheckpointSupplied bool              `json:"priorCheckpointSupplied"`
	Artifacts               int               `json:"artifacts"`
	Bytes                   int64             `json:"bytes"`
	Verified                bool              `json:"verified"`
	Installed               bool              `json:"installed"`
}

type downloadAsset struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	State string `json:"state"`
	URL   string `json:"browser_download_url"`
}
type downloadListing struct {
	Tag        string          `json:"tag_name"`
	Draft      *bool           `json:"draft"`
	Prerelease *bool           `json:"prerelease"`
	Published  string          `json:"published_at"`
	Assets     []downloadAsset `json:"assets"`
}

func Download(ctx context.Context, o DownloadOptions) (DownloadResult, error) {
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 20 * time.Second,
		IdleConnTimeout: 30 * time.Second, MaxIdleConns: 4, DisableCompression: true,
		ForceAttemptHTTP2: true,
	}
	defer transport.CloseIdleConnections()
	return download(ctx, o, transport, time.Now)
}

// Redirects are supported only for public asset delivery. API lookup cannot
// redirect. No user-provided URL or API session client enters this boundary.
func downloadRedirect(req *http.Request, via []*http.Request) error {
	u := req.URL
	if len(via) > 3 || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" {
		return errors.New("release asset redirect refused")
	}
	switch u.Host {
	case "release-assets.githubusercontent.com", "objects.githubusercontent.com":
	case "github.com":
		if len(via) == 0 || u.Path != via[0].URL.Path || u.RawQuery != "" {
			return errors.New("release asset redirect refused")
		}
	default:
		return errors.New("release asset redirect refused")
	}
	req.Header = downloadHeaders(false)
	return nil
}

func downloadHeaders(api bool) http.Header {
	h := make(http.Header)
	h.Set("User-Agent", "vaultix-cli")
	h.Set("Accept-Encoding", "identity")
	h.Set("Accept", "application/octet-stream")
	if api {
		h.Set("Accept", "application/vnd.github+json")
		h.Set("X-GitHub-Api-Version", "2026-03-10")
	}
	return h
}

func downloadBody(ctx context.Context, transport http.RoundTripper, address string, api bool, limit int64, out io.Writer) (int64, error) {
	client := &http.Client{Transport: transport, Timeout: 15 * time.Minute, CheckRedirect: downloadRedirect}
	if api {
		client.Timeout = 30 * time.Second
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return 0, errors.New("cannot prepare release download")
	}
	req.Header = downloadHeaders(api)
	response, err := client.Do(req)
	if err != nil {
		return 0, errors.New("release download failed or was cancelled")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return 0, errors.New("requested Vaultix release or asset is not publicly available")
	}
	if response.StatusCode != http.StatusOK || response.ContentLength > limit ||
		(response.Header.Get("Content-Encoding") != "" && response.Header.Get("Content-Encoding") != "identity") {
		return 0, errors.New("release response status, encoding or size refused")
	}
	n, err := io.Copy(out, io.LimitReader(response.Body, limit+1))
	if err != nil || n > limit {
		return n, errors.New("release transfer interrupted or exceeded its size limit")
	}
	return n, nil
}

func download(ctx context.Context, o DownloadOptions, transport http.RoundTripper, now func() time.Time) (DownloadResult, error) {
	var result DownloadResult
	if !validReleaseVersion(o.Version) || o.Directory == "" || o.Trust == "" {
		return result, errors.New("download requires an exact SemVer, new directory and preprovisioned trust")
	}
	v, _ := Parse(o.Version)
	if o.Preview != (len(v.pre) > 0) {
		return result, errors.New("preview versions require --preview; stable versions do not")
	}
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		return result, errors.New("release acquisition is supported on Linux and Windows")
	}
	trusted, err := ReadReleaseMetadata(o.Trust, 16384)
	if err != nil {
		return result, err
	}
	var prior *ReleaseCheckpoint
	if o.Checkpoint != "" {
		prior, err = ReadReleaseCheckpoint(o.Checkpoint)
		if err != nil {
			return result, err
		}
	}
	target, err := filepath.Abs(o.Directory)
	if err != nil {
		return result, errors.New("invalid download directory")
	}
	parent := filepath.Dir(target)
	real, err := filepath.EvalSymlinks(parent)
	if err != nil || real != parent || target == parent {
		return result, errors.New("download parent must exist and cannot traverse links")
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || runtime.GOOS != "windows" && info.Mode().Perm()&0022 != 0 {
		return result, errors.New("download parent must be a trusted directory without group/other write access")
	}
	if _, err = os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		return result, errors.New("download destination already exists or cannot be inspected")
	}
	var listingBytes bytes.Buffer
	tag := "v" + o.Version
	if _, err = downloadBody(ctx, transport, releaseAPI+url.PathEscape(tag), true, 1<<20, &listingBytes); err != nil {
		return result, err
	}
	var listing downloadListing
	if json.Unmarshal(listingBytes.Bytes(), &listing) != nil || listing.Tag != tag || listing.Draft == nil || *listing.Draft ||
		listing.Prerelease == nil || *listing.Prerelease != o.Preview || len(listing.Assets) < 9 || len(listing.Assets) > 128 {
		return result, errors.New("release listing is incomplete or does not match the requested version/channel")
	}
	published, err := time.Parse(time.RFC3339, listing.Published)
	if err != nil || published.After(now().Add(5*time.Minute)) {
		return result, errors.New("release publication timestamp is invalid")
	}
	assets, ids := map[string]downloadAsset{}, map[int64]bool{}
	for _, a := range listing.Assets {
		if !releaseName.MatchString(a.Name) || strings.Contains(a.Name, "..") || strings.HasSuffix(a.Name, ".") ||
			reservedName.MatchString(a.Name) || a.ID <= 0 || a.ID > 9007199254740991 || ids[a.ID] || assets[a.Name].ID != 0 ||
			a.State != "uploaded" || a.Size <= 0 || a.Size > 32<<30 || a.URL != assetOrigin+url.PathEscape(tag)+"/"+url.PathEscape(a.Name) {
			return result, errors.New("release contains an invalid, duplicate or foreign asset")
		}
		assets[a.Name], ids[a.ID] = a, true
	}
	metadata := func(name string, limit int64) ([]byte, error) {
		a, ok := assets[name]
		if !ok || a.Size > limit {
			return nil, errors.New("release verification metadata is absent or oversized")
		}
		var b bytes.Buffer
		n, err := downloadBody(ctx, transport, a.URL, false, a.Size, &b)
		if err != nil || n != a.Size {
			return nil, errors.New("release metadata download failed or changed size")
		}
		return b.Bytes(), nil
	}
	raw, err := metadata("release-manifest.json", 65536)
	if err != nil {
		return result, err
	}
	signed, err := metadata("release-signature.json", 4096)
	if err != nil {
		return result, err
	}
	m, checkpoint, err := VerifyRelease(raw, signed, trusted, now(), prior)
	if err != nil {
		return result, err
	}
	if m.Version != o.Version || (m.Channel == "preview") != o.Preview {
		return result, errors.New("signed release does not match the requested version/channel")
	}
	var total int64
	for _, a := range m.Artifacts {
		entry, ok := assets[a.Name]
		if !ok || entry.Size != a.Bytes || a.Name == "release-manifest.json" || a.Name == "release-signature.json" {
			return result, errors.New("release is missing a complete matching signed artifact")
		}
		total += a.Bytes
		if total > maxDownloadBytes {
			return result, errors.New("release exceeds the 64 GiB bundle limit")
		}
	}
	stage, err := os.MkdirTemp(parent, ".vaultix-download-")
	if err != nil {
		return result, errors.New("cannot create private release staging directory")
	}
	// This is only the unique directory created by this operation, never the
	// selected destination or an existing installation.
	defer os.RemoveAll(stage)
	for _, item := range []struct {
		name string
		data []byte
	}{{"release-manifest.json", raw}, {"release-signature.json", signed}} {
		if err = writeDownloadFile(filepath.Join(stage, item.name), bytes.NewReader(item.data)); err != nil {
			return result, err
		}
	}
	for _, a := range m.Artifacts {
		if o.Progress != nil {
			fmt.Fprintf(o.Progress, "Vaultix: downloading %s (%d bytes)\n", a.Name, a.Bytes)
		}
		f, err := os.OpenFile(filepath.Join(stage, a.Name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return result, errors.New("cannot create staged artifact")
		}
		h := sha256.New()
		n, transferErr := downloadBody(ctx, transport, assets[a.Name].URL, false, a.Bytes, io.MultiWriter(f, h))
		syncErr, closeErr := f.Sync(), f.Close()
		if transferErr != nil || n != a.Bytes || hex.EncodeToString(h.Sum(nil)) != a.SHA256 || syncErr != nil || closeErr != nil {
			return result, errors.New("artifact download failed size, digest or durable-write verification")
		}
	}
	if err = VerifyReleaseArtifacts(m, stage); err != nil {
		return result, err
	}
	// Rehashing a large bundle can take time. Recheck freshness after that work,
	// immediately before publication, rather than accepting an expired download.
	if _, _, err = VerifyRelease(raw, signed, trusted, now(), prior); err != nil {
		return result, err
	}
	if err = ctx.Err(); err != nil {
		return result, errors.New("release download cancelled before publication")
	}
	current, err := os.Lstat(parent)
	real, realErr := filepath.EvalSymlinks(parent)
	if err != nil || realErr != nil || real != parent || !os.SameFile(info, current) {
		return result, errors.New("download parent changed before publication")
	}
	if err = publishDownload(stage, target); err != nil {
		return result, errors.New("release publication failed; destination was not replaced")
	}
	result = DownloadResult{SchemaVersion: "vaultix.release-download.v1", Directory: target, Version: m.Version,
		Revision: m.Revision, Checkpoint: checkpoint, PriorCheckpointSupplied: prior != nil,
		Artifacts: len(m.Artifacts), Bytes: total, Verified: true, Installed: false}
	return result, nil
}

func writeDownloadFile(path string, in io.Reader) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("cannot create release metadata file")
	}
	_, err = io.Copy(f, in)
	syncErr, closeErr := f.Sync(), f.Close()
	if err != nil || syncErr != nil || closeErr != nil {
		return errors.New("cannot persist release metadata")
	}
	return nil
}
