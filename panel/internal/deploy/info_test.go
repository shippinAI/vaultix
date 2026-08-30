package deploy

import "testing"

func TestValidLabel(t *testing.T) {
	if !ValidLabel("workshop") || !ValidLabel("a") {
		t.Fatal("good labels rejected")
	}
	if ValidLabel("") || ValidLabel("Workshop") || ValidLabel("-bad") {
		t.Fatal("bad labels accepted")
	}
}

func TestLoadSelfDefault(t *testing.T) {
	t.Setenv("VAULTIX_SKU", "")
	t.Setenv("VAULTIX_LABEL", "")
	t.Setenv("VAULTIX_PUBLIC_HOST", "")
	info := Load()
	if info.SKU != SKUSelf || info.Hub {
		t.Fatalf("%+v", info)
	}
	if info.Owner != "AngryVibes LLC" || info.Product != "vaultix" {
		t.Fatalf("stamp %+v", info)
	}
}

func TestLoadHostedLabel(t *testing.T) {
	t.Setenv("VAULTIX_SKU", "hosted")
	t.Setenv("VAULTIX_LABEL", "workshop")
	t.Setenv("VAULTIX_PUBLIC_HOST", "")
	info := Load()
	if info.PublicHost != "workshop.vaultix.shippin.cloud" || info.Hub {
		t.Fatalf("%+v", info)
	}
}

func TestLoadHostedHub(t *testing.T) {
	t.Setenv("VAULTIX_SKU", "hosted")
	t.Setenv("VAULTIX_LABEL", "")
	t.Setenv("VAULTIX_PUBLIC_HOST", "")
	info := Load()
	if !info.Hub || info.PublicHost != HubHost {
		t.Fatalf("%+v", info)
	}
}
