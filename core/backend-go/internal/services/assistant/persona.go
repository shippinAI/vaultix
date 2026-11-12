package assistant

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.yaml.in/yaml/v3"

	"github.com/vaultix-cloud/api/internal/database/pg"
	"github.com/vaultix-cloud/api/internal/libs/errutil"
)

// Role is what a persona does in a conversation (docs/0124).
type Role string

const (
	RoleRouter     Role = "router"
	RoleSpecialist Role = "specialist"
	RoleGuard      Role = "guard"
)

// Domains are the canonical interaction domains (docs/interaction/workflows.json),
// one MCP warp point each at /api/vx/v1/<domain>/mcp.
var Domains = []string{"public", "auth", "workspace", "secrets", "access", "automation", "connect", "pki", "kms",
	"pam", "detect", "ai", "governance", "operate", "experience"}

var (
	Roles            = []Role{RoleRouter, RoleSpecialist, RoleGuard}
	Tiers            = []string{"fast", "standard", "deep"}
	slugPattern      = regexp.MustCompile(`^[a-z][a-z0-9-]{1,31}$`)
	maxInstructions  = 16 * 1024
	maxDescription   = 300
	maxPersonaDomain = 8
)

// Persona is a default persona from core/ai/personas, possibly changed by an
// administrator, or a custom one. It narrows what the assistant does; it never
// grants anything (docs/0124).
type Persona struct {
	Slug         string     `json:"slug"`
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Role         Role       `json:"role"`
	Domains      []string   `json:"domains"`
	Tier         string     `json:"tier"`
	Model        string     `json:"model"`
	Description  string     `json:"description"`
	Instructions string     `json:"instructions"`
	ProviderID   *uuid.UUID `json:"providerId"`
	Enabled      bool       `json:"enabled"`
	BuiltIn      bool       `json:"builtIn"`
	Customized   bool       `json:"customized"`
	UpdatedAt    *time.Time `json:"updatedAt"`
}

// PersonaInput creates or changes a persona. Nil fields stay as they are.
type PersonaInput struct {
	Slug          *string    `json:"slug"`
	Name          *string    `json:"name"`
	Role          *Role      `json:"role"`
	Domains       []string   `json:"domains"`
	Tier          *string    `json:"tier"`
	Model         *string    `json:"model"`
	Description   *string    `json:"description"`
	Instructions  *string    `json:"instructions"`
	ProviderID    *uuid.UUID `json:"providerId"`
	ClearProvider bool       `json:"clearProvider"`
	Enabled       *bool      `json:"enabled"`
}

type personaFile struct {
	ID          string   `yaml:"id"`
	Name        string   `yaml:"name"`
	Role        Role     `yaml:"role"`
	Domains     []string `yaml:"domains"`
	Tier        string   `yaml:"tier"`
	Description string   `yaml:"description"`
}

// LoadDefaultPersonas reads <dir>/personas/<slug>/PERSONA.md. The folder name is
// the slug and must match the file's id, vaultix.persona.<slug>.
func LoadDefaultPersonas(dir string) ([]Persona, error) {
	entries, err := os.ReadDir(filepath.Join(dir, "personas"))
	if err != nil {
		return nil, fmt.Errorf("reading default personas: %w", err)
	}
	personas := []Persona{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		slug := entry.Name()
		raw, err := os.ReadFile(filepath.Join(dir, "personas", slug, "PERSONA.md"))
		if err != nil {
			return nil, fmt.Errorf("persona %s: %w", slug, err)
		}
		persona, err := parsePersona(slug, raw)
		if err != nil {
			return nil, fmt.Errorf("persona %s: %w", slug, err)
		}
		personas = append(personas, *persona)
	}
	if len(personas) == 0 {
		return nil, errors.New("no default personas found")
	}
	routers := 0
	for _, p := range personas {
		if p.Role == RoleRouter {
			routers++
		}
	}
	if routers != 1 {
		return nil, fmt.Errorf("default personas need exactly one router, found %d", routers)
	}
	sort.Slice(personas, func(i, j int) bool { return personaOrder(&personas[i]) < personaOrder(&personas[j]) })
	return personas, nil
}

func personaOrder(p *Persona) string {
	return fmt.Sprintf("%d-%s", slices.Index(Roles, p.Role), p.Slug)
}

func parsePersona(slug string, raw []byte) (*Persona, error) {
	raw = bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	if !bytes.HasPrefix(raw, []byte("---\n")) {
		return nil, errors.New("missing front matter")
	}
	front, body, found := bytes.Cut(raw[4:], []byte("\n---\n"))
	if !found {
		return nil, errors.New("front matter is not closed")
	}
	var file personaFile
	if err := yaml.Unmarshal(front, &file); err != nil {
		return nil, fmt.Errorf("front matter: %w", err)
	}
	if file.ID != "vaultix.persona."+slug {
		return nil, fmt.Errorf("id %q must be vaultix.persona.%s", file.ID, slug)
	}
	p := &Persona{Slug: slug, ID: file.ID, Name: file.Name, Role: file.Role, Domains: file.Domains, Tier: file.Tier,
		Description: file.Description, Instructions: strings.TrimSpace(string(body)), Enabled: true, BuiltIn: true}
	if err := checkPersona(p); err != nil {
		return nil, err
	}
	return p, nil
}

func checkPersona(p *Persona) error {
	p.Name = strings.TrimSpace(p.Name)
	p.Description = strings.TrimSpace(p.Description)
	p.Instructions = strings.TrimSpace(p.Instructions)
	if !slugPattern.MatchString(p.Slug) {
		return errutil.BadRequest("Persona slug '%s' must be 2 to 32 lowercase letters, digits or dashes, starting with a letter.", p.Slug)
	}
	if p.Name == "" || len(p.Name) > maxNameLength {
		return errutil.BadRequest("Give the persona a name of 1 to %d characters.", maxNameLength)
	}
	if !slices.Contains(Roles, p.Role) {
		return errutil.BadRequest("Role '%s' is not router, specialist or guard.", p.Role)
	}
	if !slices.Contains(Tiers, p.Tier) {
		return errutil.BadRequest("Tier '%s' is not fast, standard or deep.", p.Tier)
	}
	p.Model = strings.TrimSpace(p.Model)
	if p.Model != "" && !validModel(p.Model) {
		return errutil.BadRequest("Model '%s' is not a valid model ID.", p.Model)
	}
	if len(p.Domains) == 0 || len(p.Domains) > maxPersonaDomain {
		return errutil.BadRequest("Give the persona 1 to %d domains.", maxPersonaDomain)
	}
	seen := map[string]bool{}
	for _, domain := range p.Domains {
		if !slices.Contains(Domains, domain) || seen[domain] {
			return errutil.BadRequest("Domain '%s' is not a Vaultix domain, or is listed twice.", domain)
		}
		seen[domain] = true
	}
	if len(p.Description) > maxDescription {
		return errutil.BadRequest("Keep the description under %d characters.", maxDescription)
	}
	if p.Instructions == "" || len(p.Instructions) > maxInstructions {
		return errutil.BadRequest("Give the persona instructions of 1 to %d characters.", maxInstructions)
	}
	return nil
}

// Personas merges the shipped defaults with what administrators changed or added.
type Personas struct {
	logger   *slog.Logger
	db       pg.DB
	defaults []Persona
}

type PersonasDeps struct {
	DB       pg.DB
	Defaults []Persona
}

func NewPersonas(_ context.Context, logger *slog.Logger, deps *PersonasDeps) *Personas {
	return &Personas{logger: logger.With(slog.String("service", "assistant-personas")), db: deps.DB, defaults: deps.Defaults}
}

type personaRow struct {
	slug, name, role, tier, model, description, instructions string
	domains                                                  []string
	providerID                                               *uuid.UUID
	enabled, builtIn                                         bool
	updatedAt                                                time.Time
}

func (s *Personas) rows(ctx context.Context) (map[string]personaRow, error) {
	rows, err := s.db.Primary().Query(ctx, `SELECT slug, name, role, tier, model, description, instructions, domains,
		"providerId", enabled, "builtIn", "updatedAt" FROM vx_ai_personas WHERE "orgId" IS NULL`)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load AI personas.").WithErrf("assistant.personas: %w", err)
	}
	defer rows.Close()
	out := map[string]personaRow{}
	for rows.Next() {
		var r personaRow
		if err := rows.Scan(&r.slug, &r.name, &r.role, &r.tier, &r.model, &r.description, &r.instructions, &r.domains,
			&r.providerID, &r.enabled, &r.builtIn, &r.updatedAt); err != nil {
			return nil, errutil.DatabaseErr("Could not load AI personas.").WithErrf("assistant.personas scan: %w", err)
		}
		out[r.slug] = r
	}
	if err := rows.Err(); err != nil {
		return nil, errutil.DatabaseErr("Could not load AI personas.").WithErrf("assistant.personas rows: %w", err)
	}
	return out, nil
}

func (r personaRow) persona(builtIn bool) Persona {
	updated := r.updatedAt
	return Persona{Slug: r.slug, ID: "vaultix.persona." + r.slug, Name: r.name, Role: Role(r.role), Domains: r.domains,
		Tier: r.tier, Model: r.model, Description: r.description, Instructions: r.instructions, ProviderID: r.providerID,
		Enabled: r.enabled, BuiltIn: builtIn, Customized: true, UpdatedAt: &updated}
}

// List returns every persona: the defaults first, as changed, then custom ones.
func (s *Personas) List(ctx context.Context) ([]Persona, error) {
	rows, err := s.rows(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Persona, 0, len(s.defaults)+len(rows))
	for _, d := range s.defaults {
		if row, ok := rows[d.Slug]; ok && row.builtIn {
			changed := row.persona(true)
			changed.Role = d.Role
			out = append(out, changed)
			delete(rows, d.Slug)
			continue
		}
		out = append(out, d)
	}
	custom := make([]Persona, 0, len(rows))
	for _, row := range rows {
		if !row.builtIn {
			custom = append(custom, row.persona(false))
		}
	}
	sort.Slice(custom, func(i, j int) bool { return personaOrder(&custom[i]) < personaOrder(&custom[j]) })
	return append(out, custom...), nil
}

func (s *Personas) find(ctx context.Context, slug string) (*Persona, error) {
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].Slug == slug {
			return &all[i], nil
		}
	}
	return nil, errutil.NotFound("Persona '%s' was not found.", slug)
}

func (s *Personas) isDefault(slug string) *Persona {
	for i := range s.defaults {
		if s.defaults[i].Slug == slug {
			return &s.defaults[i]
		}
	}
	return nil
}

func apply(p *Persona, input *PersonaInput) {
	if input.Name != nil {
		p.Name = *input.Name
	}
	if input.Role != nil {
		p.Role = *input.Role
	}
	if input.Domains != nil {
		p.Domains = input.Domains
	}
	if input.Tier != nil {
		p.Tier = *input.Tier
	}
	if input.Model != nil {
		p.Model = *input.Model
	}
	if input.Description != nil {
		p.Description = *input.Description
	}
	if input.Instructions != nil {
		p.Instructions = *input.Instructions
	}
	if input.ProviderID != nil {
		p.ProviderID = input.ProviderID
	}
	if input.ClearProvider {
		p.ProviderID = nil
	}
	if input.Enabled != nil {
		p.Enabled = *input.Enabled
	}
}

func (s *Personas) save(ctx context.Context, p *Persona, builtIn bool) (*Persona, error) {
	if p.ProviderID != nil {
		var exists bool
		if err := s.db.Primary().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL)`,
			pgx.NamedArgs{"id": *p.ProviderID}).Scan(&exists); err != nil {
			return nil, errutil.DatabaseErr("Could not save the persona.").WithErrf("assistant.personas provider: %w", err)
		}
		if !exists {
			return nil, errutil.BadRequest("AI provider '%s' was not found.", *p.ProviderID)
		}
	}
	_, err := s.db.Primary().Exec(ctx, `INSERT INTO vx_ai_personas
		(slug, name, role, tier, model, description, instructions, domains, "providerId", enabled, "builtIn")
		VALUES (@slug, @name, @role, @tier, @model, @description, @instructions, @domains, @providerId, @enabled, @builtIn)
		ON CONFLICT (slug) WHERE "orgId" IS NULL DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, tier = EXCLUDED.tier, model = EXCLUDED.model,
		description = EXCLUDED.description, instructions = EXCLUDED.instructions, domains = EXCLUDED.domains,
		"providerId" = EXCLUDED."providerId", enabled = EXCLUDED.enabled`, pgx.NamedArgs{
		"slug": p.Slug, "name": p.Name, "role": string(p.Role), "tier": p.Tier, "model": p.Model, "description": p.Description,
		"instructions": p.Instructions, "domains": p.Domains, "providerId": p.ProviderID, "enabled": p.Enabled, "builtIn": builtIn,
	})
	if err != nil {
		return nil, errutil.DatabaseErr("Could not save the persona.").WithErrf("assistant.personas save(slug=%s): %w", p.Slug, err)
	}
	return s.find(ctx, p.Slug)
}

// Create adds a custom persona. Default slugs are taken.
func (s *Personas) Create(ctx context.Context, input *PersonaInput) (*Persona, error) {
	if input.Slug == nil {
		return nil, errutil.BadRequest("Give the persona a slug.")
	}
	slug := strings.TrimSpace(*input.Slug)
	if s.isDefault(slug) != nil {
		return nil, errutil.BadRequest("'%s' is a default persona. Change it instead of creating another.", slug)
	}
	if _, err := s.find(ctx, slug); err == nil {
		return nil, errutil.BadRequest("A persona named '%s' already exists.", slug)
	}
	p := &Persona{Slug: slug, Role: RoleSpecialist, Tier: "standard", Enabled: true}
	apply(p, input)
	if p.Role == RoleRouter {
		return nil, errutil.BadRequest("There is one router, Clyffy. Add specialists or guards instead.")
	}
	if err := checkPersona(p); err != nil {
		return nil, err
	}
	return s.save(ctx, p, false)
}

// Update changes a persona. A default keeps its role.
func (s *Personas) Update(ctx context.Context, slug string, input *PersonaInput) (*Persona, error) {
	current, err := s.find(ctx, slug)
	if err != nil {
		return nil, err
	}
	if input.Slug != nil && *input.Slug != slug {
		return nil, errutil.BadRequest("A persona's slug cannot change.")
	}
	next := *current
	apply(&next, input)
	if current.BuiltIn && next.Role != current.Role {
		return nil, errutil.BadRequest("A default persona keeps its role.")
	}
	if !current.BuiltIn && next.Role == RoleRouter {
		return nil, errutil.BadRequest("There is one router, Clyffy.")
	}
	if next.Role == RoleRouter && !next.Enabled {
		return nil, errutil.BadRequest("Clyffy routes every conversation and cannot be turned off. Turn off the assistant by deactivating its provider.")
	}
	if err := checkPersona(&next); err != nil {
		return nil, err
	}
	return s.save(ctx, &next, current.BuiltIn)
}

// Reset returns a default persona to the shipped text and settings.
func (s *Personas) Reset(ctx context.Context, slug string) (*Persona, error) {
	if s.isDefault(slug) == nil {
		return nil, errutil.BadRequest("Only default personas can be reset. Remove a custom persona instead.")
	}
	if _, err := s.db.Primary().Exec(ctx, `DELETE FROM vx_ai_personas WHERE slug = @slug AND "orgId" IS NULL`, pgx.NamedArgs{"slug": slug}); err != nil {
		return nil, errutil.DatabaseErr("Could not reset the persona.").WithErrf("assistant.personas reset(slug=%s): %w", slug, err)
	}
	return s.find(ctx, slug)
}

// Delete removes a custom persona. Defaults are turned off or reset instead.
func (s *Personas) Delete(ctx context.Context, slug string) (*Persona, error) {
	if s.isDefault(slug) != nil {
		return nil, errutil.BadRequest("'%s' is a default persona. Turn it off or reset it instead.", slug)
	}
	current, err := s.find(ctx, slug)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Primary().Exec(ctx, `DELETE FROM vx_ai_personas WHERE slug = @slug AND "orgId" IS NULL`, pgx.NamedArgs{"slug": slug}); err != nil {
		return nil, errutil.DatabaseErr("Could not remove the persona.").WithErrf("assistant.personas delete(slug=%s): %w", slug, err)
	}
	return current, nil
}
