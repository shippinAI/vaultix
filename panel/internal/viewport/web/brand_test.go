package web

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPaperBrandMatchesWelcome(t *testing.T) {
	css, err := os.ReadFile("brand.css")
	if err != nil {
		t.Fatal(err)
	}
	tokens, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "branding", "tokens.css"))
	if err != nil {
		t.Fatal(err)
	}
	const paper = "--vaultix-bg: oklch(0.97 0.01 95)"
	if !strings.Contains(string(css), paper) || !strings.Contains(string(tokens), paper) {
		t.Fatal("panel brand.css and branding/tokens.css drifted")
	}
	page, err := os.ReadFile("welcome.html")
	if err != nil {
		t.Fatal(err)
	}
	text := string(page)
	for _, need := range []string{"Name the app.", "Put a key.", "vaultix run --config dev -- npm run dev", "Vaultix"} {
		if !strings.Contains(text, need) {
			t.Fatalf("welcome missing %s", need)
		}
	}
}

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
	if strings.Contains(strings.ToLower(s), "infisical") || strings.Contains(strings.ToLower(s), "authentik") {
		t.Fatal("wordmark carries leftover brand")
	}
}

func TestCustomerSurfacesForbidLeftoverBrand(t *testing.T) {
	roots := []string{
		".",
		filepath.Join("..", "..", "..", "..", "branding"),
	}
	bad := []string{"infisical", "authentik"}
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
