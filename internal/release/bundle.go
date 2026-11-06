package release

// This verifier owns no installation or trust-key mutation. Its caller supplies
// pre-provisioned trust and retains the returned checkpoint after acceptance.
import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"time"
)

type ReleaseArtifact struct {
	Name     string  `json:"name"`
	Kind     string  `json:"kind"`
	Platform string  `json:"platform"`
	Bytes    int64   `json:"bytes"`
	SHA256   string  `json:"sha256"`
	ImageID  *string `json:"imageId"`
}
type ReleaseMigration struct {
	From     []string `json:"from"`
	To       string   `json:"to"`
	Rollback string   `json:"rollback"`
}
type ReleaseManifest struct {
	SchemaVersion         string            `json:"schemaVersion"`
	Version               string            `json:"version"`
	Channel               string            `json:"channel"`
	Revision              string            `json:"revision"`
	Sequence              int64             `json:"sequence"`
	IssuedAt              string            `json:"issuedAt"`
	ExpiresAt             string            `json:"expiresAt"`
	MinimumUpdaterVersion string            `json:"minimumUpdaterVersion"`
	Migration             ReleaseMigration  `json:"migration"`
	Artifacts             []ReleaseArtifact `json:"artifacts"`
}
type ReleaseCheckpoint struct {
	SchemaVersion string `json:"schemaVersion"`
	Sequence      int64  `json:"sequence"`
	SHA256        string `json:"sha256"`
}
type releaseSignature struct {
	SchemaVersion string `json:"schemaVersion"`
	KeyID         string `json:"keyId"`
	Signature     string `json:"signature"`
}
type releaseKey struct {
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
}
type releaseTrust struct {
	SchemaVersion string       `json:"schemaVersion"`
	Keys          []releaseKey `json:"keys"`
}

var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var releaseName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)
var reservedName = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)`)
var releaseRevision = regexp.MustCompile(`^[a-f0-9]{40}$`)
var releaseDate = regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$`)

func hashBytes(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func fieldsPresent(value any, typ reflect.Type) bool {
	if typ.Kind() == reflect.Pointer {
		return true
	} // Nullable field still must be present in its parent.
	if typ.Kind() == reflect.Slice {
		items, ok := value.([]any)
		if !ok {
			return false
		}
		for _, item := range items {
			if !fieldsPresent(item, typ.Elem()) {
				return false
			}
		}
		return true
	}
	if typ.Kind() != reflect.Struct {
		return value != nil
	}
	obj, ok := value.(map[string]any)
	if !ok || len(obj) != typ.NumField() {
		return false
	}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		v, exists := obj[f.Tag.Get("json")]
		if !exists || !fieldsPresent(v, f.Type) {
			return false
		}
	}
	return true
}
func decodeCanonical(raw []byte, limit int, target any) error {
	if len(raw) == 0 || len(raw) > limit {
		return errors.New("release metadata size limit")
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return errors.New("invalid release JSON")
	}
	var canonical bytes.Buffer
	encoder := json.NewEncoder(&canonical)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if encoder.Encode(value) != nil || !bytes.Equal(canonical.Bytes(), raw) {
		return errors.New("release JSON must use canonical encoding")
	}
	if !fieldsPresent(value, reflect.TypeOf(target).Elem()) {
		return errors.New("missing or unknown release fields")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		return errors.New("invalid release field type")
	}
	return nil
}
func validReleaseVersion(s string) bool {
	_, ok := Parse(s)
	return ok && strings.TrimSpace(s) == s && !strings.HasPrefix(s, "v") && !strings.HasPrefix(s, "V")
}
func parseReleaseTime(s string) (time.Time, error) {
	if !releaseDate.MatchString(s) {
		return time.Time{}, errors.New("invalid release timestamp")
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil || t.Format(time.RFC3339) != s {
		return time.Time{}, errors.New("invalid release timestamp")
	}
	return t, nil
}
func validateRelease(m ReleaseManifest) error {
	fail := errors.New("invalid release manifest")
	if (m.SchemaVersion != "vaultix.release-manifest.v1" && m.SchemaVersion != "vaultix.release-manifest.v2") || !validReleaseVersion(m.Version) || !validReleaseVersion(m.MinimumUpdaterVersion) || !releaseRevision.MatchString(m.Revision) || m.Sequence <= 0 || m.Sequence > 9007199254740991 {
		return fail
	}
	v, _ := Parse(m.Version)
	if (m.Channel != "stable" && m.Channel != "preview") || (m.Channel == "preview") != (len(v.pre) > 0) {
		return fail
	}
	issued, err := parseReleaseTime(m.IssuedAt)
	if err != nil {
		return err
	}
	expires, err := parseReleaseTime(m.ExpiresAt)
	if err != nil || !expires.After(issued) || expires.Sub(issued) > 90*24*time.Hour {
		return fail
	}
	if len(m.Migration.From) == 0 || len(m.Migration.From) > 100 || !releaseName.MatchString(m.Migration.To) || (m.Migration.Rollback != "compatible" && m.Migration.Rollback != "restore-required") {
		return fail
	}
	schemas := map[string]bool{}
	for _, s := range m.Migration.From {
		if !releaseName.MatchString(s) || schemas[s] {
			return fail
		}
		schemas[s] = true
	}
	if len(m.Artifacts) < 7 || len(m.Artifacts) > 64 {
		return fail
	}
	names, identities := map[string]bool{}, map[string]bool{}
	peers := map[string]ReleaseArtifact{}
	engine, source, sbom, packages := 0, 0, 0, 0
	for _, a := range m.Artifacts {
		if !releaseName.MatchString(a.Name) || strings.Contains(a.Name, "..") || strings.HasSuffix(a.Name, ".") || reservedName.MatchString(a.Name) || names[a.Name] || a.Bytes <= 0 || a.Bytes > 32*1024*1024*1024 || !digestPattern.MatchString(a.SHA256) {
			return fail
		}
		names[a.Name] = true
		if a.Kind != "engine" && a.ImageID != nil {
			return fail
		}
		switch a.Kind {
		case "engine":
			if a.Platform != "linux/amd64" || a.ImageID == nil || !strings.HasPrefix(*a.ImageID, "sha256:") || !digestPattern.MatchString(strings.TrimPrefix(*a.ImageID, "sha256:")) {
				return fail
			}
			engine++
		case "cli":
			suffix := "-linux-amd64"
			if a.Platform == "windows/amd64" {
				suffix = "-windows-amd64.exe"
			} else if a.Platform != "linux/amd64" {
				return fail
			}
			if a.Name != "vaultix"+suffix && a.Name != "vaultixl"+suffix {
				return fail
			}
			if identities[a.Name] {
				return fail
			}
			identities[a.Name] = true
			if peer, ok := peers[a.Platform]; ok && (peer.Bytes != a.Bytes || peer.SHA256 != a.SHA256) {
				return fail
			}
			peers[a.Platform] = a
		case "cli-package":
			if m.SchemaVersion != "vaultix.release-manifest.v2" || a.Platform != "windows/amd64" || a.Name != "vaultix-cli-windows-amd64.msix" || a.Bytes > 512<<20 {
				return fail
			}
			packages++
		case "source", "sbom":
			if a.Platform != "any" {
				return fail
			}
			if a.Kind == "source" {
				source++
			} else {
				sbom++
			}
		default:
			return fail
		}
	}
	if engine != 1 || source != 1 || sbom != 1 || len(identities) != 4 {
		return fail
	}
	if (m.SchemaVersion == "vaultix.release-manifest.v2" && (packages != 1 || m.MinimumUpdaterVersion != "1.1.0")) ||
		(m.SchemaVersion == "vaultix.release-manifest.v1" && (packages != 0 || m.MinimumUpdaterVersion != "1.0.0")) {
		return fail
	}
	return nil
}

func VerifyRelease(raw, signed, trusted []byte, now time.Time, previous *ReleaseCheckpoint) (ReleaseManifest, ReleaseCheckpoint, error) {
	var m ReleaseManifest
	var checkpoint ReleaseCheckpoint
	if err := decodeCanonical(raw, 65536, &m); err != nil {
		return m, checkpoint, err
	}
	if err := validateRelease(m); err != nil {
		return m, checkpoint, err
	}
	var signature releaseSignature
	var trust releaseTrust
	if err := decodeCanonical(signed, 4096, &signature); err != nil {
		return m, checkpoint, err
	}
	if err := decodeCanonical(trusted, 16384, &trust); err != nil {
		return m, checkpoint, err
	}
	fail := errors.New("release signature or trust verification failed")
	if signature.SchemaVersion != "vaultix.release-signature.v1" || !digestPattern.MatchString(signature.KeyID) || trust.SchemaVersion != "vaultix.release-trust.v1" || len(trust.Keys) == 0 || len(trust.Keys) > 16 {
		return m, checkpoint, fail
	}
	ids := map[string]bool{}
	var selected ed25519.PublicKey
	for _, entry := range trust.Keys {
		der, err := base64.StdEncoding.Strict().DecodeString(entry.PublicKey)
		if err != nil || base64.StdEncoding.EncodeToString(der) != entry.PublicKey || hashBytes(der) != entry.KeyID || ids[entry.KeyID] {
			return m, checkpoint, fail
		}
		ids[entry.KeyID] = true
		key, err := x509.ParsePKIXPublicKey(der)
		if err != nil {
			return m, checkpoint, fail
		}
		public, ok := key.(ed25519.PublicKey)
		if !ok {
			return m, checkpoint, fail
		}
		if entry.KeyID == signature.KeyID {
			selected = public
		}
	}
	sig, err := base64.StdEncoding.Strict().DecodeString(signature.Signature)
	if err != nil || base64.StdEncoding.EncodeToString(sig) != signature.Signature || len(selected) != ed25519.PublicKeySize || !ed25519.Verify(selected, raw, sig) {
		return m, checkpoint, fail
	}
	issued, _ := parseReleaseTime(m.IssuedAt)
	expires, _ := parseReleaseTime(m.ExpiresAt)
	if issued.After(now.Add(5*time.Minute)) || !expires.After(now) {
		return m, checkpoint, errors.New("release metadata is expired or issued in the future")
	}
	if m.MinimumUpdaterVersion != "1.0.0" && m.MinimumUpdaterVersion != "1.1.0" {
		return m, checkpoint, errors.New("unsupported updater version")
	}
	checkpoint = ReleaseCheckpoint{SchemaVersion: "vaultix.release-checkpoint.v1", Sequence: m.Sequence, SHA256: hashBytes(raw)}
	if previous != nil && (previous.SchemaVersion != "vaultix.release-checkpoint.v1" || previous.Sequence <= 0 || previous.Sequence > 9007199254740991 || !digestPattern.MatchString(previous.SHA256) || m.Sequence < previous.Sequence || (m.Sequence == previous.Sequence && checkpoint.SHA256 != previous.SHA256)) {
		return m, checkpoint, errors.New("replayed or conflicting release metadata")
	}
	return m, checkpoint, nil
}

func ReadReleaseMetadata(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("cannot open release metadata")
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("release metadata must be a regular file")
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, errors.New("release metadata size limit")
	}
	return data, nil
}
func ReadReleaseCheckpoint(path string) (*ReleaseCheckpoint, error) {
	raw, err := ReadReleaseMetadata(path, 4096)
	if err != nil {
		return nil, err
	}
	var checkpoint ReleaseCheckpoint
	if err := decodeCanonical(raw, 4096, &checkpoint); err != nil {
		return nil, err
	}
	return &checkpoint, nil
}
func VerifyReleaseArtifacts(m ReleaseManifest, directory string) error {
	if err := validateRelease(m); err != nil {
		return err
	}
	root, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return errors.New("cannot open release bundle")
	}
	for _, a := range m.Artifacts {
		if err := verifyReleaseFile(root, a); err != nil {
			return fmt.Errorf("artifact %s: %w", a.Name, err)
		}
	}
	return nil
}
func verifyReleaseFile(root string, a ReleaseArtifact) error {
	path := filepath.Join(root, a.Name)
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() {
		return errors.New("not a regular artifact file")
	}
	actual, err := filepath.EvalSymlinks(path)
	if err != nil || actual != path {
		return errors.New("artifact link refused")
	}
	f, err := os.Open(path)
	if err != nil {
		return errors.New("cannot open artifact")
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !os.SameFile(before, info) || info.Size() != a.Bytes {
		return errors.New("artifact identity or size mismatch")
	}
	h := sha256.New()
	count, err := io.Copy(h, io.LimitReader(f, a.Bytes+1))
	if err != nil || count != a.Bytes || hex.EncodeToString(h.Sum(nil)) != a.SHA256 {
		return errors.New("artifact digest mismatch")
	}
	after, err := f.Stat()
	if err != nil || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return errors.New("artifact changed during verification")
	}
	current, err := os.Lstat(path)
	if err != nil || !current.Mode().IsRegular() || !os.SameFile(current, info) {
		return errors.New("artifact path replaced")
	}
	return nil
}
