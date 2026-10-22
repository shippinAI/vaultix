// Package tenantprefix names the tables one shared-database tenant owns.
// Provisioning uses vx_<shortid>_ so a person can read the owner off the name.
package tenantprefix

import (
	"os"
	"regexp"
	"strings"
)

// sampleLogical are the tables an operator checks first.
var sampleLogical = []string{
	"organizations",
	"projects",
	"project_environments",
	"secrets_v2",
	"vaultix_migrations",
}

// shortID is 1–8 lowercase letters or digits. vx_ + id is at most 11
// characters, which is the engine stem limit.
var shortIDRe = regexp.MustCompile(`^[a-z0-9]{1,8}$`)

// Table is one logical name and the physical name Postgres stores.
type Table struct {
	Logical  string `json:"logical"`
	Physical string `json:"physical"`
}

// View is metadata for the manager. No secret names and no values.
type View struct {
	Isolation string  `json:"isolation"`
	Prefix    string  `json:"prefix,omitempty"`
	ShortID   string  `json:"shortId,omitempty"`
	Readable  bool    `json:"readable"`
	Headline  string  `json:"headline"`
	Tables    []Table `json:"tables"`
}

// FromEnv reads VX_ISOLATION and DB_TABLE_PREFIX.
func FromEnv() View {
	return Describe(os.Getenv("VX_ISOLATION"), os.Getenv("DB_TABLE_PREFIX"))
}

// Format builds vx_<shortid>_.
func Format(shortID string) (string, error) {
	id := strings.ToLower(strings.TrimSpace(shortID))
	if !shortIDRe.MatchString(id) {
		return "", errShortID
	}
	return "vx_" + id + "_", nil
}

// Describe explains a prefix the way the manager should show it.
func Describe(isolation, raw string) View {
	prefix := normalize(raw)
	mode := strings.ToLower(strings.TrimSpace(isolation))
	if prefix == "" {
		if mode == "" {
			mode = "dedicated"
		}
		return View{
			Isolation: mode,
			Readable:  mode != "prefix",
			Headline:  "This instance owns every table in its database. Names stay organizations, projects, and secrets_v2.",
			Tables:    physical("", sampleLogical),
		}
	}
	if mode == "" {
		mode = "prefix"
	}
	id, readable := parseReadable(prefix)
	headline := "Tables for this process start with " + prefix + "."
	if readable {
		headline = "Tenant " + id + " owns the tables that start with " + prefix + "."
	} else if mode == "prefix" {
		headline = "Prefix " + prefix + " is set. Shared-database tenants use vx_<shortid>_ so the owner is obvious. These tables still start with " + prefix + "."
	}
	return View{
		Isolation: mode,
		Prefix:    prefix,
		ShortID:   id,
		Readable:  readable,
		Headline:  headline,
		Tables:    physical(prefix, sampleLogical),
	}
}

func physical(prefix string, names []string) []Table {
	out := make([]Table, len(names))
	for i, name := range names {
		out[i] = Table{Logical: name, Physical: prefix + name}
	}
	return out
}

func normalize(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return ""
	}
	if strings.HasSuffix(value, "_") {
		return value
	}
	return value + "_"
}

func parseReadable(prefix string) (string, bool) {
	if !strings.HasPrefix(prefix, "vx_") || !strings.HasSuffix(prefix, "_") {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(prefix, "vx_"), "_")
	if !shortIDRe.MatchString(id) {
		return "", false
	}
	return id, true
}
