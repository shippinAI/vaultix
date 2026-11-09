// Disposable-guest release fixtures. This public test key is never publisher trust.
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func digest(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func canonical(v any) []byte {
	b, err := json.Marshal(v)
	must(err)
	var obj any
	must(json.Unmarshal(b, &obj))
	b, err = json.MarshalIndent(obj, "", "  ")
	must(err)
	return append(b, '\n')
}
func main() {
	if os.Getenv("USERNAME") != "WDAGUtilityAccount" || len(os.Args) != 7 {
		panic("disposable Windows guest fixture only: directory version sequence revision exe msix")
	}
	dir, version, revision := os.Args[1], os.Args[2], os.Args[4]
	if !strings.HasPrefix(filepath.Clean(dir), `C:\Probe\`) {
		panic("fixture directory outside guest work root")
	}
	sequence, err := strconv.ParseInt(os.Args[3], 10, 64)
	must(err)
	code, err := os.ReadFile(os.Args[5])
	must(err)
	pkg, err := os.ReadFile(os.Args[6])
	must(err)
	must(os.MkdirAll(dir, 0700))
	seed, err := hex.DecodeString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
	must(err)
	key := ed25519.NewKeyFromSeed(seed)
	der, err := x509.MarshalPKIXPublicKey(key.Public())
	must(err)
	keyID := digest(der)
	names := []string{"vaultix-linux-amd64", "vaultixl-linux-amd64", "vaultix-windows-amd64.exe", "vaultixl-windows-amd64.exe", "engine.tar", "source.tar", "sbom.json", "vaultix-cli-windows-amd64.msix"}
	artifacts := []any{}
	for i, name := range names {
		body := []byte("signed non-selected fixture artifact")
		kind, platform := "cli", "linux/amd64"
		var image any
		switch i {
		case 2, 3:
			body = code
			platform = "windows/amd64"
		case 4:
			kind = "engine"
			image = "sha256:" + strings.Repeat("b", 64)
		case 5:
			kind = "source"
			platform = "any"
		case 6:
			kind = "sbom"
			platform = "any"
		case 7:
			kind = "cli-package"
			platform = "windows/amd64"
			body = pkg
		}
		artifacts = append(artifacts, map[string]any{"name": name, "kind": kind, "platform": platform, "bytes": len(body), "sha256": digest(body), "imageId": image})
		must(os.WriteFile(filepath.Join(dir, name), body, 0600))
	}
	now := time.Now().UTC()
	manifest := canonical(map[string]any{"schemaVersion": "vaultix.release-manifest.v2", "version": version, "channel": "stable", "revision": revision, "sequence": sequence, "issuedAt": now.Add(-time.Minute).Format(time.RFC3339), "expiresAt": now.Add(time.Hour).Format(time.RFC3339), "minimumUpdaterVersion": "1.1.0", "migration": map[string]any{"from": []string{"schema-a"}, "to": "schema-a", "rollback": "compatible"}, "artifacts": artifacts})
	must(os.WriteFile(filepath.Join(dir, "release-manifest.json"), manifest, 0600))
	must(os.WriteFile(filepath.Join(dir, "release-signature.json"), canonical(map[string]any{"schemaVersion": "vaultix.release-signature.v1", "keyId": keyID, "signature": base64.StdEncoding.EncodeToString(ed25519.Sign(key, manifest))}), 0600))
	must(os.WriteFile(filepath.Join(dir, "trust.json"), canonical(map[string]any{"schemaVersion": "vaultix.release-trust.v1", "keys": []any{map[string]any{"keyId": keyID, "publicKey": base64.StdEncoding.EncodeToString(der)}}}), 0600))
	fmt.Println("Disposable signed bundle created")
}
