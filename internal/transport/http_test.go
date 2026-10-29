package transport

import "testing"

func TestURLBoundary(t *testing.T) {
	for _, raw := range []string{"https://vaultix.example", "http://127.0.0.1:8200", "http://[::1]:8200"} {
		if _, err := URL(raw); err != nil {
			t.Fatalf("valid URL rejected: %s", raw)
		}
	}
	for _, raw := range []string{"http://vaultix.example", "http://localhost:8200", "https://user:password@vaultix.example", "https://vaultix.example/#fragment", "file:///tmp/token", "https://vaultix.example/\nsecret"} {
		if _, err := URL(raw); err == nil {
			t.Fatalf("unsafe URL accepted: %s", raw)
		}
	}
}
