// Package assistant runs the in-app Vaultix assistant: the AI providers an
// instance administrator manages, the model adapters, and the agent loop that
// acts only through the instance's own MCP tools with the signed-in person's
// session (docs/0123).
package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix-cloud/api/internal/database/pg"
	"github.com/vaultix-cloud/api/internal/libs/errutil"
)

// Kind names a way to reach a model. Anthropic, Bedrock and Vertex speak the
// Anthropic Messages format; OpenAI and OpenAI-compatible servers (vLLM,
// Ollama) speak chat completions.
type Kind string

const (
	KindAnthropic        Kind = "anthropic"
	KindBedrock          Kind = "bedrock"
	KindVertex           Kind = "vertex"
	KindOpenAI           Kind = "openai"
	KindOpenAICompatible Kind = "openai-compatible"
)

// Kinds lists every supported provider kind, in the order the admin page shows them.
var Kinds = []Kind{KindAnthropic, KindBedrock, KindVertex, KindOpenAI, KindOpenAICompatible}

const (
	maxProviders     = 20
	maxNameLength    = 64
	maxModelLength   = 128
	maxBaseURLLength = 512
	maxKeyLength     = 4096
	maxAccountLength = 16 * 1024
	maxTestMessage   = 300
)

var (
	modelPattern   = regexp.MustCompile(`^[A-Za-z0-9._:/@-]+$`)
	awsRegion      = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]$`)
	gcpRegion      = regexp.MustCompile(`^(global|[a-z]+-[a-z]+[0-9])$`)
	gcpProject     = regexp.MustCompile(`^[a-z][a-z0-9-]{4,28}[a-z0-9]$`)
	awsAccessKeyID = regexp.MustCompile(`^[A-Z0-9]{16,128}$`)
)

// Provider is the metadata of a configured provider. It never holds the credential.
type Provider struct {
	ID              uuid.UUID  `json:"id"`
	Kind            Kind       `json:"kind"`
	Name            string     `json:"name"`
	Model           string     `json:"model"`
	BaseURL         string     `json:"baseUrl"`
	Region          string     `json:"region"`
	CloudProject    string     `json:"cloudProject"`
	HasCredential   bool       `json:"hasCredential"`
	Active          bool       `json:"active"`
	LastTestedAt    *time.Time `json:"lastTestedAt"`
	LastTestOutcome string     `json:"lastTestOutcome"`
	LastTestMessage string     `json:"lastTestMessage"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

// Credential is what a provider needs to authenticate. It is decrypted only to
// call that provider and never returned by the API.
type Credential struct {
	APIKey             string `json:"apiKey,omitempty"`
	AccessKeyID        string `json:"accessKeyId,omitempty"`
	SecretAccessKey    string `json:"secretAccessKey,omitempty"`
	SessionToken       string `json:"sessionToken,omitempty"`
	ServiceAccountJSON string `json:"serviceAccountJson,omitempty"`
}

func (c *Credential) empty() bool {
	return c.APIKey == "" && c.AccessKeyID == "" && c.SecretAccessKey == "" && c.SessionToken == "" && c.ServiceAccountJSON == ""
}

// ProviderInput creates or changes a provider. Nil fields stay as they are on
// update. A non-nil Credential replaces the stored one entirely.
type ProviderInput struct {
	Kind         *Kind       `json:"kind"`
	Name         *string     `json:"name"`
	Model        *string     `json:"model"`
	BaseURL      *string     `json:"baseUrl"`
	Region       *string     `json:"region"`
	CloudProject *string     `json:"cloudProject"`
	Credential   *Credential `json:"credential"`
	Active       *bool       `json:"active"`
}

// Cipher encrypts provider credentials under the instance root key.
type Cipher interface {
	Encrypt([]byte) ([]byte, error)
	Decrypt([]byte) ([]byte, error)
}

// CipherSource returns the root-key cipher once the KMS has started.
type CipherSource func() (Cipher, error)

// Store keeps providers in vx_ai_providers.
type Store struct {
	logger *slog.Logger
	db     pg.DB
	cipher CipherSource
}

type StoreDeps struct {
	DB     pg.DB
	Cipher CipherSource
}

func NewStore(_ context.Context, logger *slog.Logger, deps *StoreDeps) *Store {
	return &Store{logger: logger.With(slog.String("service", "assistant-providers")), db: deps.DB, cipher: deps.Cipher}
}

const providerColumns = `id, kind, name, model, "baseUrl", region, "cloudProject", "encryptedCredential" IS NOT NULL,
	active, "lastTestedAt", "lastTestOutcome", "lastTestMessage", "createdAt", "updatedAt"`

func scanProvider(row pgx.Row) (*Provider, error) {
	var p Provider
	var lastTestedAt *time.Time
	var outcome, message *string
	if err := row.Scan(&p.ID, &p.Kind, &p.Name, &p.Model, &p.BaseURL, &p.Region, &p.CloudProject, &p.HasCredential,
		&p.Active, &lastTestedAt, &outcome, &message, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	p.LastTestedAt = lastTestedAt
	if outcome != nil {
		p.LastTestOutcome = *outcome
	}
	if message != nil {
		p.LastTestMessage = *message
	}
	return &p, nil
}

// List returns every provider, the active one first.
func (s *Store) List(ctx context.Context) ([]Provider, error) {
	rows, err := s.db.Replica().Query(ctx, `SELECT `+providerColumns+` FROM vx_ai_providers WHERE "orgId" IS NULL ORDER BY active DESC, "createdAt" ASC`)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load AI providers.").WithErrf("assistant.List: %w", err)
	}
	defer rows.Close()
	providers := []Provider{}
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, errutil.DatabaseErr("Could not load AI providers.").WithErrf("assistant.List scan: %w", err)
		}
		providers = append(providers, *p)
	}
	if err := rows.Err(); err != nil {
		return nil, errutil.DatabaseErr("Could not load AI providers.").WithErrf("assistant.List rows: %w", err)
	}
	return providers, nil
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (*Provider, error) {
	p, err := scanProvider(s.db.Primary().QueryRow(ctx, `SELECT `+providerColumns+` FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL`, pgx.NamedArgs{"id": id}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI provider '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load the AI provider.").WithErrf("assistant.Get(id=%s): %w", id, err)
	}
	return p, nil
}

// Active returns the active provider and its credential, or nil when none is active.
func (s *Store) Active(ctx context.Context) (*Provider, *Credential, error) {
	p, err := scanProvider(s.db.Primary().QueryRow(ctx, `SELECT `+providerColumns+` FROM vx_ai_providers WHERE active AND "orgId" IS NULL`))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, errutil.DatabaseErr("Could not load the active AI provider.").WithErrf("assistant.Active: %w", err)
	}
	credential, err := s.credential(ctx, p.ID)
	if err != nil {
		return nil, nil, err
	}
	return p, credential, nil
}

func (s *Store) credential(ctx context.Context, id uuid.UUID) (*Credential, error) {
	var blob []byte
	err := s.db.Primary().QueryRow(ctx, `SELECT "encryptedCredential" FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL`, pgx.NamedArgs{"id": id}).Scan(&blob)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load the AI provider.").WithErrf("assistant.credential(id=%s): %w", id, err)
	}
	if len(blob) == 0 {
		return &Credential{}, nil
	}
	c, err := s.cipher()
	if err != nil {
		return nil, errutil.InternalServer("The instance key is unavailable.").WithErrf("assistant.credential: %w", err)
	}
	plain, err := c.Decrypt(blob)
	if err != nil {
		return nil, errutil.InternalServer("The stored AI provider credential could not be read.").WithErrf("assistant.credential decrypt(id=%s): %w", id, err)
	}
	var credential Credential
	if err := json.Unmarshal(plain, &credential); err != nil {
		return nil, errutil.InternalServer("The stored AI provider credential could not be read.").WithErrf("assistant.credential parse(id=%s): %w", id, err)
	}
	return &credential, nil
}

// ProviderWithCredential loads a provider for a connection test.
func (s *Store) ProviderWithCredential(ctx context.Context, id uuid.UUID) (*Provider, *Credential, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	credential, err := s.credential(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	return p, credential, nil
}

func (s *Store) seal(credential *Credential) ([]byte, error) {
	if credential == nil || credential.empty() {
		return nil, nil
	}
	plain, err := json.Marshal(credential)
	if err != nil {
		return nil, errutil.InternalServer("Could not store the credential.").WithErrf("assistant.seal: %w", err)
	}
	c, err := s.cipher()
	if err != nil {
		return nil, errutil.InternalServer("The instance key is unavailable.").WithErrf("assistant.seal: %w", err)
	}
	blob, err := c.Encrypt(plain)
	if err != nil {
		return nil, errutil.InternalServer("Could not store the credential.").WithErrf("assistant.seal encrypt: %w", err)
	}
	return blob, nil
}

// Create validates and stores a new provider. A provider created active
// replaces the previously active one.
func (s *Store) Create(ctx context.Context, input *ProviderInput) (*Provider, error) {
	if input.Kind == nil || input.Name == nil || input.Model == nil {
		return nil, errutil.BadRequest("Choose a provider kind and give it a name and a model.")
	}
	p := &Provider{Kind: *input.Kind, Name: *input.Name, Model: *input.Model,
		BaseURL: deref(input.BaseURL), Region: deref(input.Region), CloudProject: deref(input.CloudProject)}
	credential := input.Credential
	if credential == nil {
		credential = &Credential{}
	}
	if err := normalize(p, credential, true); err != nil {
		return nil, err
	}
	blob, err := s.seal(credential)
	if err != nil {
		return nil, err
	}
	active := input.Active != nil && *input.Active

	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI provider.").WithErrf("assistant.Create begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vx_ai_providers WHERE "orgId" IS NULL`).Scan(&count); err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI provider.").WithErrf("assistant.Create count: %w", err)
	}
	if count >= maxProviders {
		return nil, errutil.BadRequest("An instance can keep at most %d AI providers. Remove one first.", maxProviders)
	}
	if active {
		if _, err := tx.Exec(ctx, `UPDATE vx_ai_providers SET active = false WHERE active AND "orgId" IS NULL`); err != nil {
			return nil, errutil.DatabaseErr("Could not save the AI provider.").WithErrf("assistant.Create deactivate: %w", err)
		}
	}
	created, err := scanProvider(tx.QueryRow(ctx, `INSERT INTO vx_ai_providers
		(kind, name, model, "baseUrl", region, "cloudProject", "encryptedCredential", active)
		VALUES (@kind, @name, @model, @baseUrl, @region, @cloudProject, @credential, @active)
		RETURNING `+providerColumns, pgx.NamedArgs{
		"kind": p.Kind, "name": p.Name, "model": p.Model, "baseUrl": p.BaseURL, "region": p.Region,
		"cloudProject": p.CloudProject, "credential": blob, "active": active,
	}))
	if err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI provider.").WithErrf("assistant.Create insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI provider.").WithErrf("assistant.Create commit: %w", err)
	}
	return created, nil
}

// Update changes the named fields. Changing how the provider is reached clears
// its last test, since that result no longer describes it.
func (s *Store) Update(ctx context.Context, id uuid.UUID, input *ProviderInput) (*Provider, error) {
	current, stored, err := s.ProviderWithCredential(ctx, id)
	if err != nil {
		return nil, err
	}
	if input.Kind != nil && *input.Kind != current.Kind {
		return nil, errutil.BadRequest("A provider's kind cannot change. Add a new provider instead.")
	}
	next := *current
	if input.Name != nil {
		next.Name = *input.Name
	}
	if input.Model != nil {
		next.Model = *input.Model
	}
	if input.BaseURL != nil {
		next.BaseURL = *input.BaseURL
	}
	if input.Region != nil {
		next.Region = *input.Region
	}
	if input.CloudProject != nil {
		next.CloudProject = *input.CloudProject
	}
	credential := stored
	replaced := input.Credential != nil
	if replaced {
		credential = input.Credential
	}
	if err := normalize(&next, credential, replaced); err != nil {
		return nil, err
	}
	reach := next.Model != current.Model || next.BaseURL != current.BaseURL || next.Region != current.Region ||
		next.CloudProject != current.CloudProject || replaced

	var blob []byte
	if replaced {
		if blob, err = s.seal(credential); err != nil {
			return nil, err
		}
	}

	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not update the AI provider.").WithErrf("assistant.Update begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if input.Active != nil && *input.Active {
		if _, err := tx.Exec(ctx, `UPDATE vx_ai_providers SET active = false WHERE active AND "orgId" IS NULL AND id <> @id`, pgx.NamedArgs{"id": id}); err != nil {
			return nil, errutil.DatabaseErr("Could not update the AI provider.").WithErrf("assistant.Update deactivate: %w", err)
		}
	}
	active := current.Active
	if input.Active != nil {
		active = *input.Active
	}
	updated, err := scanProvider(tx.QueryRow(ctx, `UPDATE vx_ai_providers SET
		name = @name, model = @model, "baseUrl" = @baseUrl, region = @region, "cloudProject" = @cloudProject,
		"encryptedCredential" = CASE WHEN @replaced THEN @credential ELSE "encryptedCredential" END,
		active = @active,
		"lastTestedAt" = CASE WHEN @reach THEN NULL ELSE "lastTestedAt" END,
		"lastTestOutcome" = CASE WHEN @reach THEN NULL ELSE "lastTestOutcome" END,
		"lastTestMessage" = CASE WHEN @reach THEN NULL ELSE "lastTestMessage" END
		WHERE id = @id AND "orgId" IS NULL RETURNING `+providerColumns, pgx.NamedArgs{
		"id": id, "name": next.Name, "model": next.Model, "baseUrl": next.BaseURL, "region": next.Region,
		"cloudProject": next.CloudProject, "replaced": replaced, "credential": blob, "active": active, "reach": reach,
	}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI provider '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not update the AI provider.").WithErrf("assistant.Update(id=%s): %w", id, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, errutil.DatabaseErr("Could not update the AI provider.").WithErrf("assistant.Update commit: %w", err)
	}
	return updated, nil
}

func (s *Store) Delete(ctx context.Context, id uuid.UUID) (*Provider, error) {
	deleted, err := scanProvider(s.db.Primary().QueryRow(ctx, `DELETE FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL RETURNING `+providerColumns, pgx.NamedArgs{"id": id}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI provider '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not remove the AI provider.").WithErrf("assistant.Delete(id=%s): %w", id, err)
	}
	return deleted, nil
}

// RecordTest stores the outcome of a real connection test.
func (s *Store) RecordTest(ctx context.Context, id uuid.UUID, passed bool, message string, at time.Time) (*Provider, error) {
	outcome := "failed"
	if passed {
		outcome = "passed"
	}
	if len(message) > maxTestMessage {
		message = message[:maxTestMessage]
	}
	p, err := scanProvider(s.db.Primary().QueryRow(ctx, `UPDATE vx_ai_providers
		SET "lastTestedAt" = @at, "lastTestOutcome" = @outcome, "lastTestMessage" = @message
		WHERE id = @id AND "orgId" IS NULL RETURNING `+providerColumns, pgx.NamedArgs{"id": id, "at": at, "outcome": outcome, "message": message}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI provider '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not record the test.").WithErrf("assistant.RecordTest(id=%s): %w", id, err)
	}
	return p, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// normalize trims and validates a provider and, when it is being set, its credential.
func normalize(p *Provider, c *Credential, credentialChanged bool) error {
	p.Name = strings.TrimSpace(p.Name)
	p.Model = strings.TrimSpace(p.Model)
	p.BaseURL = strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	p.Region = strings.TrimSpace(p.Region)
	p.CloudProject = strings.TrimSpace(p.CloudProject)
	c.APIKey = strings.TrimSpace(c.APIKey)
	c.AccessKeyID = strings.TrimSpace(c.AccessKeyID)
	c.SecretAccessKey = strings.TrimSpace(c.SecretAccessKey)
	c.SessionToken = strings.TrimSpace(c.SessionToken)
	c.ServiceAccountJSON = strings.TrimSpace(c.ServiceAccountJSON)

	known := false
	for _, k := range Kinds {
		known = known || k == p.Kind
	}
	if !known {
		return errutil.BadRequest("Unknown provider kind '%s'.", p.Kind)
	}
	if p.Name == "" || len(p.Name) > maxNameLength {
		return errutil.BadRequest("Give the provider a name of 1 to %d characters.", maxNameLength)
	}
	if p.Model == "" || len(p.Model) > maxModelLength || !modelPattern.MatchString(p.Model) {
		return errutil.BadRequest("Model '%s' is not a valid model ID.", p.Model)
	}
	if p.BaseURL != "" {
		if err := checkBaseURL(p.BaseURL); err != nil {
			return err
		}
	}
	if len(c.APIKey) > maxKeyLength || len(c.AccessKeyID) > maxKeyLength || len(c.SecretAccessKey) > maxKeyLength ||
		len(c.SessionToken) > maxKeyLength || len(c.ServiceAccountJSON) > maxAccountLength {
		return errutil.BadRequest("The credential is too long.")
	}

	switch p.Kind {
	case KindAnthropic, KindOpenAI:
		p.Region, p.CloudProject = "", ""
		if credentialChanged && c.APIKey == "" {
			return errutil.BadRequest("Enter the API key for %s.", p.Kind)
		}
		*c = Credential{APIKey: c.APIKey}
	case KindOpenAICompatible:
		p.Region, p.CloudProject = "", ""
		if p.BaseURL == "" {
			return errutil.BadRequest("Enter the server's base URL, for example http://gpu-host:8000/v1.")
		}
		*c = Credential{APIKey: c.APIKey}
	case KindBedrock:
		p.CloudProject = ""
		if !awsRegion.MatchString(p.Region) {
			return errutil.BadRequest("Region '%s' is not an AWS region, such as us-east-1.", p.Region)
		}
		if credentialChanged && (!awsAccessKeyID.MatchString(c.AccessKeyID) || c.SecretAccessKey == "") {
			return errutil.BadRequest("Enter the AWS access key ID and secret access key.")
		}
		*c = Credential{AccessKeyID: c.AccessKeyID, SecretAccessKey: c.SecretAccessKey, SessionToken: c.SessionToken}
	case KindVertex:
		if !gcpRegion.MatchString(p.Region) {
			return errutil.BadRequest("Region '%s' is not a Google Cloud region, such as us-east5 or global.", p.Region)
		}
		if !gcpProject.MatchString(p.CloudProject) {
			return errutil.BadRequest("Project '%s' is not a Google Cloud project ID.", p.CloudProject)
		}
		if credentialChanged {
			var account struct {
				Type        string `json:"type"`
				ClientEmail string `json:"client_email"`
				PrivateKey  string `json:"private_key"`
			}
			if json.Unmarshal([]byte(c.ServiceAccountJSON), &account) != nil || account.Type != "service_account" ||
				account.ClientEmail == "" || account.PrivateKey == "" {
				return errutil.BadRequest("Paste a Google Cloud service account key file (JSON) with access to Vertex AI.")
			}
		}
		*c = Credential{ServiceAccountJSON: c.ServiceAccountJSON}
	}
	return nil
}

func checkBaseURL(raw string) error {
	if len(raw) > maxBaseURLLength {
		return errutil.BadRequest("The base URL is too long.")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errutil.BadRequest("The base URL must be an http or https address without a username, query or fragment.")
	}
	return nil
}

// describe names a provider in messages without exposing anything secret.
func describe(p *Provider) string {
	return fmt.Sprintf("%s (%s, %s)", p.Name, p.Kind, p.Model)
}
