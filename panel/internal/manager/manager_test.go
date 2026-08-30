package manager

import (
	"path/filepath"
	"testing"

	"shippin.cloud/vaultix/panel/internal/deploy"
)

func TestRegisterAndSelf(t *testing.T) {
	p := filepath.Join(t.TempDir(), "mgr.json")
	r, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.EnsureSelf(deploy.Info{SKU: deploy.SKUSelf, PublicHost: "127.0.0.1:8201"}, "community"); err != nil {
		t.Fatal(err)
	}
	got, err := r.Register("workshop", deploy.SKUHosted, "enterprise")
	if err != nil {
		t.Fatal(err)
	}
	if got.PublicHost != "workshop.vaultix.shippin.cloud" {
		t.Fatalf("%+v", got)
	}
	list := r.List()
	if len(list) != 2 {
		t.Fatalf("list %d", len(list))
	}
	if _, err := r.Register("Bad", deploy.SKUSelf, "community"); err != ErrBadLabel {
		t.Fatalf("want bad label, got %v", err)
	}
}
