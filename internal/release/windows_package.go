package release

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"sort"
	"strings"
)

// This is the single package layout used by the builder and the installer.
// Unknown applications, capabilities, dependencies or extensions are refused.
//
//go:embed windows-cli.xml
var windowsCLIManifest string

func windowsPackageVersion(sequence int64) string {
	s := uint64(sequence)
	return fmt.Sprintf("%d.%d.%d.%d", s>>48, (s>>32)&65535, (s>>16)&65535, s&65535)
}
func packageManifest(publisher string, sequence int64) []byte {
	var escaped bytes.Buffer
	_ = xml.EscapeText(&escaped, []byte(publisher))
	return []byte(strings.NewReplacer("{{PUBLISHER}}", escaped.String(), "{{VERSION}}", windowsPackageVersion(sequence)).Replace(windowsCLIManifest))
}

// XML equality is semantic: namespace URI + local name and sorted attributes.
// Reject duplicate attributes, directives, entities and processing instructions
// except a leading XML declaration. Ignore formatting whitespace and comments.
func packageXMLTokens(raw []byte) ([]any, error) {
	if len(raw) == 0 || len(raw) > 65536 {
		return nil, errors.New("package manifest size limit")
	}
	d := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})))
	tokens := []any{}
	for {
		token, err := d.Token()
		if err == io.EOF {
			return tokens, nil
		}
		if err != nil {
			return nil, errors.New("invalid package XML")
		}
		switch t := token.(type) {
		case xml.StartElement:
			attrs := []xml.Attr{}
			seen := map[xml.Name]bool{}
			for _, attr := range t.Attr {
				if seen[attr.Name] {
					return nil, errors.New("duplicate package attribute")
				}
				seen[attr.Name] = true
				if attr.Name.Space == "xmlns" || (attr.Name.Space == "" && attr.Name.Local == "xmlns") {
					continue
				}
				attrs = append(attrs, attr)
			}
			sort.Slice(attrs, func(i, j int) bool {
				if attrs[i].Name.Space != attrs[j].Name.Space {
					return attrs[i].Name.Space < attrs[j].Name.Space
				}
				return attrs[i].Name.Local < attrs[j].Name.Local
			})
			t.Attr = attrs
			tokens = append(tokens, t)
		case xml.EndElement:
			tokens = append(tokens, t)
		case xml.CharData:
			if value := strings.TrimSpace(string(t)); value != "" {
				tokens = append(tokens, value)
			}
		case xml.Comment:
		case xml.ProcInst:
			if len(tokens) != 0 || t.Target != "xml" {
				return nil, errors.New("unexpected package processing instruction")
			}
		default:
			return nil, errors.New("unexpected package XML directive")
		}
	}
}
func validatePackageManifest(raw []byte, sequence int64) (string, error) {
	tokens, err := packageXMLTokens(raw)
	if err != nil {
		return "", err
	}
	publisher := ""
	for _, token := range tokens {
		if t, ok := token.(xml.StartElement); ok && t.Name.Space == "http://schemas.microsoft.com/appx/manifest/foundation/windows10" && t.Name.Local == "Identity" {
			for _, a := range t.Attr {
				if a.Name.Space == "" && a.Name.Local == "Publisher" {
					if publisher != "" {
						return "", errors.New("duplicate package identity")
					}
					publisher = a.Value
				}
			}
		}
	}
	if publisher == "" || len(publisher) > 8192 {
		return "", errors.New("invalid package publisher")
	}
	expected, err := packageXMLTokens(packageManifest(publisher, sequence))
	if err != nil || !reflect.DeepEqual(tokens, expected) {
		return "", errors.New("package manifest differs from the native Vaultix layout or release sequence")
	}
	return publisher, nil
}
func windowsCLIArtifact(m ReleaseManifest, name string) (ReleaseArtifact, error) {
	for _, a := range m.Artifacts {
		if a.Kind == "cli" && a.Platform == "windows/amd64" && a.Name == name+"-windows-amd64.exe" && a.Bytes <= 256<<20 {
			return a, nil
		}
	}
	return ReleaseArtifact{}, errors.New("matching Windows native CLI artifact is missing")
}
func windowsMSIXArtifact(m ReleaseManifest) (ReleaseArtifact, error) {
	if m.SchemaVersion != "vaultix.release-manifest.v2" {
		return ReleaseArtifact{}, errors.New("Windows installation requires a signed v2 release with a native package")
	}
	for _, a := range m.Artifacts {
		if a.Kind == "cli-package" && a.Name == "vaultix-cli-windows-amd64.msix" && a.Platform == "windows/amd64" && a.Bytes <= 512<<20 {
			return a, nil
		}
	}
	return ReleaseArtifact{}, errors.New("native Windows package is missing")
}
func validateWindowsPackage(path string, m ReleaseManifest) (string, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("Windows package must be a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return "", errors.New("Windows package changed")
	}
	a, err := windowsMSIXArtifact(m)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(f, a.Bytes+1))
	if err != nil || n != a.Bytes || hex.EncodeToString(h.Sum(nil)) != a.SHA256 {
		return "", errors.New("Windows package differs from signed release")
	}
	z, err := zip.NewReader(f, a.Bytes)
	if err != nil || len(z.File) < 7 || len(z.File) > 8 {
		return "", errors.New("invalid Windows package archive")
	}
	limits := map[string]uint64{"AppxManifest.xml": 65536, "[Content_Types].xml": 65536, "AppxBlockMap.xml": 4 << 20, "AppxSignature.p7x": 1 << 20, "AppxMetadata/CodeIntegrity.cat": 1 << 20, "Vaultix.png": 1 << 20, "vaultix.exe": 256 << 20, "vaultixl.exe": 256 << 20}
	seen := map[string]bool{}
	publisher := ""
	for _, file := range z.File {
		limit, ok := limits[file.Name]
		if !ok || seen[file.Name] || !file.Mode().IsRegular() || file.UncompressedSize64 == 0 || file.UncompressedSize64 > limit {
			return "", errors.New("unexpected or oversized Windows package entry")
		}
		seen[file.Name] = true
		in, err := file.Open()
		if err != nil {
			return "", err
		}
		switch file.Name {
		case "AppxManifest.xml":
			raw, e := io.ReadAll(io.LimitReader(in, int64(limit)+1))
			err = e
			if err == nil {
				publisher, err = validatePackageManifest(raw, m.Sequence)
			}
		case "vaultix.exe", "vaultixl.exe":
			var expected ReleaseArtifact
			expected, err = windowsCLIArtifact(m, strings.TrimSuffix(file.Name, ".exe"))
			if err == nil {
				h := sha256.New()
				var n int64
				n, err = io.Copy(h, io.LimitReader(in, expected.Bytes+1))
				if err == nil && (n != expected.Bytes || hex.EncodeToString(h.Sum(nil)) != expected.SHA256) {
					err = errors.New("packaged CLI differs from the signed native executable")
				}
			}
		default:
			_, err = io.Copy(io.Discard, io.LimitReader(in, int64(limit)+1))
		}
		closeErr := in.Close()
		if err != nil {
			return "", err
		}
		if closeErr != nil {
			return "", closeErr
		}
	}
	for name := range limits {
		if name != "AppxMetadata/CodeIntegrity.cat" && !seen[name] {
			return "", errors.New("required Windows package entry is missing")
		}
	}
	return publisher, nil
}
