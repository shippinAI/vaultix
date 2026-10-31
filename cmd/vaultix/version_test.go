package main

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestVersionAndUpdateCommands(t *testing.T) {
	var out bytes.Buffer
	if err := printVersion([]string{"--json"}, &out); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || result["product"] != "Vaultix CLI" || result["version"] == "" {
		t.Fatal("invalid version JSON")
	}
	if err := printVersion([]string{"--unknown"}, &out); err == nil {
		t.Fatal("unknown version flag accepted")
	}
	for _, args := range [][]string{nil, {"install"}, {"check", "--force"}, {"check", "--json", "extra"}} {
		if err := checkUpdate(context.Background(), args, &out); err == nil {
			t.Fatal("unknown update operation accepted")
		}
	}
	t.Setenv("VAULTIX_DISABLE_UPDATE_CHECK", "true")
	out.Reset()
	if err := checkUpdate(context.Background(), []string{"check", "--json"}, &out); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || result["state"] != "disabled" {
		t.Fatal("disabled status missing")
	}
}
