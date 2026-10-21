package vault

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPostgresRoundTrip(t *testing.T) {
	dsn := os.Getenv("VAULTIX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("VAULTIX_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	e, err := OpenPostgres(ctx, dsn, testKey)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	box, err := e.CreateBox(ctx, "pg-tenant", "pg app")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.PutSecret(ctx, box.ID, "dev", "K", "pg-secret", "pg-tenant"); err != nil {
		t.Fatal(err)
	}
	got, err := e.Reveal(ctx, box.ID, "dev", "K")
	if err != nil || got != "pg-secret" {
		t.Fatalf("reveal %q %v", got, err)
	}
	handle, _, err := e.MintInject(ctx, box.ID, "dev", "K", "pg-tenant", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	r, err := e.ConsumeInject(ctx, handle)
	if err != nil || r.Value != "pg-secret" {
		t.Fatalf("redeem %+v %v", r, err)
	}
}
