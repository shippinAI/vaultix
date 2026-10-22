// Package prefix rewrites Vaultix physical names in SQL so several instances
// can share one Postgres database. It follows core/backend/src/db/table-prefix.ts.
// Arguments are data, not names, and are left unchanged. CopyFrom and SendBatch
// are not rewritten; the sidecar does not use them.
package prefix

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed physical-tables.json
var manifestJSON []byte

const identMax = 63

// Aux tables and the knex migrations table live in physical-tables.json
// alongside TableName. Keep that file aligned with knownPhysicalTables().

type manifest struct {
	Tables   []string `json:"tables"`
	Routines []string `json:"routines"`
}

// Prefixer rewrites one DB_TABLE_PREFIX. An empty prefix is the identity.
type Prefixer struct {
	prefix   string
	tables   map[string]struct{}
	ordered  []string
	routines map[string]struct{}
}

// Normalize returns "" or a lowercase prefix ending in "_".
func Normalize(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	stem := strings.TrimSuffix(value, "_")
	if !validStem(stem) {
		return "", fmt.Errorf("DB_TABLE_PREFIX must be empty or start with a lowercase letter and contain only lowercase letters, digits, and underscores (at most 11 characters). Example: acme")
	}
	return stem + "_", nil
}

func validStem(stem string) bool {
	if stem == "" || len(stem) > 11 {
		return false
	}
	for i, r := range stem {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9' && i > 0:
		case r == '_' && i > 0:
		default:
			return false
		}
	}
	return true
}

// FitIdent prefixes name and keeps the result within 63 bytes.
func FitIdent(prefix, name string) string {
	full := prefix + name
	if len(full) <= identMax {
		return full
	}
	sum := sha256.Sum256([]byte(full))
	hash := hex.EncodeToString(sum[:])[:8]
	budget := identMax - len(prefix) - 1 - len(hash)
	if budget < 0 {
		budget = 0
	}
	if len(name) > budget {
		name = name[:budget]
	}
	return prefix + name + "_" + hash
}

// Apply prefixes name. A name that already starts with prefix is unchanged.
func Apply(prefix, name string) string {
	if prefix == "" || strings.HasPrefix(strings.ToLower(name), prefix) {
		return name
	}
	return FitIdent(prefix, name)
}

// New builds a prefixer from an explicit table list. Tests use this.
func New(raw string, tables, routines []string) (*Prefixer, error) {
	normalized, err := Normalize(raw)
	if err != nil {
		return nil, err
	}
	tableSet := make(map[string]struct{}, len(tables))
	ordered := make([]string, 0, len(tables))
	for _, name := range tables {
		lower := strings.ToLower(name)
		if _, ok := tableSet[lower]; ok {
			continue
		}
		tableSet[lower] = struct{}{}
		ordered = append(ordered, lower)
	}
	sortByLenDesc(ordered)
	routineSet := make(map[string]struct{}, len(routines))
	for _, name := range routines {
		routineSet[strings.ToLower(name)] = struct{}{}
	}
	return &Prefixer{prefix: normalized, tables: tableSet, ordered: ordered, routines: routineSet}, nil
}

// Load reads the embedded table list and DB_TABLE_PREFIX.
func Load(raw string) (*Prefixer, error) {
	var decoded manifest
	if err := json.Unmarshal(manifestJSON, &decoded); err != nil {
		return nil, fmt.Errorf("reading physical table list: %w", err)
	}
	return New(raw, decoded.Tables, decoded.Routines)
}

// Prefix is the normalized prefix, including the trailing underscore.
func (p *Prefixer) Prefix() string {
	if p == nil {
		return ""
	}
	return p.prefix
}

// Rewrite returns sql with physical names prefixed. An empty prefix returns sql.
func (p *Prefixer) Rewrite(sql string) string {
	if p == nil || p.prefix == "" || sql == "" {
		return sql
	}
	return p.rewrite(sql, true)
}

func sortByLenDesc(names []string) {
	for i := 1; i < len(names); i++ {
		j := i
		for j > 0 && len(names[j]) > len(names[j-1]) {
			names[j], names[j-1] = names[j-1], names[j]
			j--
		}
	}
}

func (p *Prefixer) classify(original string) (string, bool) {
	lower := strings.ToLower(original)
	if strings.HasPrefix(lower, p.prefix) {
		return "", false
	}
	if _, ok := p.routines[lower]; ok {
		return FitIdent(p.prefix, original), true
	}
	if _, ok := p.tables[lower]; ok {
		return FitIdent(p.prefix, lower), true
	}
	for _, table := range p.ordered {
		if strings.HasPrefix(lower, table+"_") {
			return FitIdent(p.prefix, table+original[len(table):]), true
		}
	}
	return "", false
}

func (p *Prefixer) forceObjectName(original string) string {
	lower := strings.ToLower(original)
	_, schema := schemaQualifiers[lower]
	if strings.HasPrefix(lower, p.prefix) || schema {
		return original
	}
	if next, ok := p.classify(original); ok {
		return next
	}
	return FitIdent(p.prefix, original)
}

func (p *Prefixer) prefixStringLiteral(content string) string {
	body, stripped := splitPublicQualifier(content)
	lower := strings.ToLower(body)
	if strings.HasPrefix(lower, p.prefix) {
		if stripped {
			return body
		}
		return content
	}
	for _, table := range p.ordered {
		if !strings.HasPrefix(lower, table) {
			continue
		}
		next := ""
		if len(lower) > len(table) {
			next = lower[len(table) : len(table)+1]
		}
		if next == "" || next == "_" || next == "%" {
			return FitIdent(p.prefix, table) + body[len(table):]
		}
	}
	if next, ok := p.classify(body); ok {
		return next
	}
	return content
}

func (p *Prefixer) rewriteCatalogString(content, codeTail string) string {
	body, _ := splitPublicQualifier(content)
	tail := strings.ReplaceAll(codeTail, `"`, "")
	if catalogNameAssign.MatchString(tail) && identRe.MatchString(body) {
		if strings.HasPrefix(strings.ToLower(body), p.prefix) {
			return body
		}
		if next, ok := p.classify(body); ok {
			return next
		}
		return FitIdent(p.prefix, body)
	}
	return p.prefixStringLiteral(content)
}

// splitPublicQualifier turns `public.users` into `users`. Other schemas stay qualified.
func splitPublicQualifier(content string) (body string, stripped bool) {
	if len(content) >= 7 && strings.EqualFold(content[:7], "public.") {
		rest := content[7:]
		if rest != "" && isIdentStart(rest[0]) {
			return rest, true
		}
	}
	return content, false
}

func (p *Prefixer) shouldDropPublic(name string, expectName bool) bool {
	lower := strings.ToLower(name)
	if _, schema := schemaQualifiers[lower]; schema {
		return false
	}
	if strings.HasPrefix(lower, p.prefix) {
		return true
	}
	if _, ok := p.classify(name); ok {
		return true
	}
	return expectName
}
