package tenantprefix

import "testing"

func TestFormatReadablePrefix(t *testing.T) {
	got, err := Format("AB12")
	if err != nil || got != "vx_ab12_" {
		t.Fatalf("format: %q %v", got, err)
	}
	if _, err := Format("way-too-long-id"); err == nil {
		t.Fatal("expected a long id to fail")
	}
	if _, err := Format("ab_c"); err == nil {
		t.Fatal("expected an underscore in the short id to fail")
	}
}

func TestDescribeShowsWhoOwnsTheTables(t *testing.T) {
	view := Describe("prefix", "vx_ab12")
	if !view.Readable || view.ShortID != "ab12" || view.Prefix != "vx_ab12_" {
		t.Fatalf("view: %+v", view)
	}
	if view.Tables[0].Physical != "vx_ab12_organizations" {
		t.Fatalf("physical: %+v", view.Tables[0])
	}
	found := false
	for _, table := range view.Tables {
		if table.Physical == "vx_ab12_secrets_v2" {
			found = true
		}
	}
	if !found {
		t.Fatal("secrets table missing")
	}
}

func TestOpaquePrefixIsLabeled(t *testing.T) {
	view := Describe("prefix", "t1")
	if view.Readable {
		t.Fatal("t1 should not count as vx_<shortid>_")
	}
	if view.Tables[0].Physical != "t1_organizations" {
		t.Fatalf("physical: %s", view.Tables[0].Physical)
	}
	if view.Headline == "" || view.Prefix != "t1_" {
		t.Fatalf("headline: %+v", view)
	}
}

func TestDedicatedInstanceHasNoPrefix(t *testing.T) {
	view := Describe("", "")
	if view.Isolation != "dedicated" || view.Prefix != "" {
		t.Fatalf("dedicated: %+v", view)
	}
	if view.Tables[0].Physical != "organizations" {
		t.Fatalf("unprefixed: %s", view.Tables[0].Physical)
	}
}
