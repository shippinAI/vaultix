// Alignment enforcement for ADR 0005: the contract, the wire quarantine,
// and the canonical namespace schema must not drift apart. These tests read
// the schema files as inputs — change the schema, not the test.
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const (
	contractPath  = "../contracts/shippin.vaultix.panel.v1.json"
	namespacePath = "../schemas/shippin.vaultix.api.v1.json"
)

var brandTokenAllowed = map[string]int{}

type namespaceSchema struct {
	Naming struct {
		PublicRoutePattern string `json:"publicRoutePattern"`
		CapabilityPattern  string `json:"capabilityPattern"`
		ContractIDPattern  string `json:"contractIdPattern"`
	} `json:"naming"`
}

type contract struct {
	ServiceID    string   `json:"serviceId"`
	Capabilities []string `json:"capabilities"`
	API          struct {
		Routes []struct {
			Method string `json:"method"`
			Path   string `json:"path"`
		} `json:"routes"`
	} `json:"api"`
}

func loadJSON(t *testing.T, path string, v any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
}

func TestContractMatchesNamingCanon(t *testing.T) {
	var ns namespaceSchema
	var c contract
	loadJSON(t, namespacePath, &ns)
	loadJSON(t, contractPath, &c)

	routeRe := regexp.MustCompile(ns.Naming.PublicRoutePattern)
	capRe := regexp.MustCompile(ns.Naming.CapabilityPattern)

	if c.ServiceID != "shippin.vaultix" {
		t.Errorf("serviceId %q", c.ServiceID)
	}
	if len(c.API.Routes) == 0 || len(c.Capabilities) == 0 {
		t.Fatal("contract has no routes or no capabilities — wrong file?")
	}
	for _, r := range c.API.Routes {
		if !routeRe.MatchString(r.Path) {
			t.Errorf("route %s %s violates publicRoutePattern", r.Method, r.Path)
		}
	}
	for _, cap := range c.Capabilities {
		if !capRe.MatchString(cap) {
			t.Errorf("capability %q violates capabilityPattern", cap)
		}
	}
}

func TestBrandTokenQuarantine(t *testing.T) {
	re := regexp.MustCompile(`(?i)vaultix`)
	err := filepath.WalkDir(".", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		n := len(re.FindAll(raw, -1))
		if allowed, ok := brandTokenAllowed[filepath.ToSlash(path)]; ok {
			if n > allowed {
				t.Errorf("%s: %d brand tokens, schema allows %d", path, n, allowed)
			}
			return nil
		}
		if n > 0 {
			t.Errorf("%s: brand token outside allowlist (%d occurrences)", path, n)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Contract routes/capabilities must be brand-free (provenance block in
	// source.upstream is licensing fact and exempt).
	var c contract
	loadJSON(t, contractPath, &c)
	for _, r := range c.API.Routes {
		if re.MatchString(r.Path) {
			t.Errorf("contract route %s carries a brand token", r.Path)
		}
	}
	for _, cap := range c.Capabilities {
		if re.MatchString(cap) {
			t.Errorf("capability %s carries a brand token", cap)
		}
	}
}
