package web

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWordmarkIsVaultix(t *testing.T) {
	raw, err := Files.ReadFile("wordmark.svg")
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, need := range []string{"VAULTIX", "SHIPPIN.AI", "ANGRYVIBES LLC"} {
		if !strings.Contains(s, need) {
			t.Fatalf("wordmark missing %s", need)
		}
	}
	if strings.Contains(strings.ToLower(s), "valutix") || strings.Contains(strings.ToLower(s), "authentik") {
		t.Fatal("wordmark carries leftover brand")
	}
}

func TestCustomerSurfacesForbidLeftoverBrand(t *testing.T) {
	roots := []string{
		".",
		filepath.Join("..", "..", "..", "..", "branding"),
	}
	bad := []string{"valutix", "authentik"}
	for _, root := range roots {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			ext := strings.ToLower(filepath.Ext(path))
			if strings.HasSuffix(path, "strings.yaml") {
				return nil // names the forbid-list; not customer chrome
			}
			if ext != ".svg" && ext != ".html" && ext != ".js" && ext != ".css" {
				return nil
			}
			if strings.HasSuffix(path, "_test.go") {
				return nil
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			low := strings.ToLower(string(b))
			for _, tok := range bad {
				if strings.Contains(low, tok) {
					t.Errorf("%s: leftover brand %q", path, tok)
				}
			}
			return nil
		})
	}
}
