package vault

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"
)

const testKey = "000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f"

func TestTablesPrefixedVaultix(t *testing.T) {
	re := regexp.MustCompile(`(?i)create table(?: if not exists)?\s+(\w+)`)
	found := 0
	for _, m := range re.FindAllStringSubmatch(Schema, -1) {
		found++
		if !strings.HasPrefix(m[1], "vaultix_") {
			t.Errorf("table %s is not vaultix_ — this is not the leftover dump", m[1])
		}
	}
	if found < 4 {
		t.Fatalf("expected vaultix_ tables, found %d", found)
	}
	if strings.Contains(strings.ToLower(Schema), "infisical") {
		t.Fatal("schema carries leftover brand")
	}
}

func TestPutRevealRoundTrip(t *testing.T) {
	e := mustMem(t)
	ctx := context.Background()
	box, err := e.CreateBox(ctx, "jessay", "my app")
	if err != nil {
		t.Fatal(err)
	}
	if box.Slug != "my-app" {
		t.Fatalf("slug: %s", box.Slug)
	}
	meta, err := e.PutSecret(ctx, box.ID, "dev", "API_KEY", "sk-secret", "jessay")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Version != 1 || meta.Name != "API_KEY" {
		t.Fatalf("meta: %+v", meta)
	}
	got, err := e.Reveal(ctx, box.ID, "dev", "API_KEY")
	if err != nil {
		t.Fatal(err)
	}
	if got != "sk-secret" {
		t.Fatalf("reveal: %q", got)
	}
	list, err := e.ListSecretMeta(ctx, box.ID, "dev")
	if err != nil {
		t.Fatal(err)
	}
	raw := list[0]
	if raw.Name != "API_KEY" || raw.Version != 1 {
		t.Fatalf("list: %+v", raw)
	}
}

func TestPutIncrementsVersion(t *testing.T) {
	e := mustMem(t)
	ctx := context.Background()
	box, _ := e.CreateBox(ctx, "t", "app")
	e.PutSecret(ctx, box.ID, "dev", "K", "v1", "t")
	meta, err := e.PutSecret(ctx, box.ID, "dev", "K", "v2", "t")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Version != 2 {
		t.Fatalf("version %d", meta.Version)
	}
	got, _ := e.Reveal(ctx, box.ID, "dev", "K")
	if got != "v2" {
		t.Fatalf("got %q", got)
	}
}

func TestInjectOneShot(t *testing.T) {
	e := mustMem(t)
	ctx := context.Background()
	box, _ := e.CreateBox(ctx, "t", "app")
	e.PutSecret(ctx, box.ID, "dev", "K", "secret-value", "t")
	handle, exp, err := e.MintInject(ctx, box.ID, "dev", "K", "t", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if handle == "" || exp.Before(time.Now()) {
		t.Fatalf("handle/exp: %s %v", handle, exp)
	}
	r, err := e.ConsumeInject(ctx, handle)
	if err != nil {
		t.Fatal(err)
	}
	if r.Value != "secret-value" || r.Name != "K" {
		t.Fatalf("redeem: %+v", r)
	}
	if _, err := e.ConsumeInject(ctx, handle); err != ErrConsumed {
		t.Fatalf("want consumed, got %v", err)
	}
}

func TestInjectMissingSecret(t *testing.T) {
	e := mustMem(t)
	ctx := context.Background()
	box, _ := e.CreateBox(ctx, "t", "app")
	if _, _, err := e.MintInject(ctx, box.ID, "dev", "NOPE", "t", time.Minute); err != ErrNotFound {
		t.Fatalf("want not found, got %v", err)
	}
}

func TestSealedAtRest(t *testing.T) {
	e := mustMem(t)
	ctx := context.Background()
	box, _ := e.CreateBox(ctx, "t", "app")
	e.PutSecret(ctx, box.ID, "dev", "K", "plaintext-secret", "t")
	s := e.secrets[secretKey(box.ID, "dev", "K")]
	if strings.Contains(string(s.ct), "plaintext-secret") {
		t.Fatal("ciphertext contains plaintext")
	}
}

func mustMem(t *testing.T) *Memory {
	t.Helper()
	e, err := OpenMemory(testKey)
	if err != nil {
		t.Fatal(err)
	}
	return e
}
