package store

import (
	"path/filepath"
	"testing"
)

const keyA = "000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f"
const keyB = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

func TestSealUnsealRoundtrip(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "s.json"), keyA)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := s.Seal(Credential{ClientID: "id", ClientSecret: "sec"})
	if err != nil {
		t.Fatal(err)
	}
	if sealed == "" || sealed == "idsec" {
		t.Fatal("sealed blob looks wrong")
	}
	got, err := s.Unseal(sealed)
	if err != nil || got.ClientSecret != "sec" {
		t.Fatalf("unseal: %v %+v", err, got)
	}
}

func TestUnsealWrongKeyFails(t *testing.T) {
	dir := t.TempDir()
	a, _ := Open(filepath.Join(dir, "a.json"), keyA)
	b, _ := Open(filepath.Join(dir, "b.json"), keyB)
	sealed, err := a.Seal(Credential{ClientID: "id", ClientSecret: "sec"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.Unseal(sealed); err == nil {
		t.Fatal("wrong key must fail to unseal")
	}
}

func TestPersistenceAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.json")
	s1, err := Open(path, keyA)
	if err != nil {
		t.Fatal(err)
	}
	if err := s1.PutPin("u", "i", PinRecord{Hash: "h"}); err != nil {
		t.Fatal(err)
	}
	sealed, _ := s1.Seal(Credential{ClientID: "c", ClientSecret: "s"})
	if err := s1.PutLink(LinkRecord{BaseURL: "https://x", SealedCredential: sealed}); err != nil {
		t.Fatal(err)
	}

	s2, err := Open(path, keyA)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := s2.GetPin("u", "i"); !ok {
		t.Fatal("pin lost across reopen")
	}
	link, ok := s2.GetLink()
	if !ok || link.BaseURL != "https://x" {
		t.Fatal("link lost across reopen")
	}
	if got, err := s2.Unseal(link.SealedCredential); err != nil || got.ClientSecret != "s" {
		t.Fatalf("credential lost: %v", err)
	}
	if err := s2.DeleteLink(); err != nil {
		t.Fatal(err)
	}
	if _, ok := s2.GetLink(); ok {
		t.Fatal("link should be gone")
	}
}

func TestBadKeyRejected(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "s.json"), "short"); err == nil {
		t.Fatal("short key must be rejected")
	}
}
