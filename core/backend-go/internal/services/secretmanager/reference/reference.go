// Package reference reads authorized secret names without loading values or ciphertext.
package reference

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/permission"
	permsecret "github.com/vaultix/api/internal/services/permission/secretmanager"
)

type PermissionService interface {
	GetProjectPermission(context.Context, *permission.GetProjectPermissionArgs) (*permission.GetProjectPermissionResult, error)
}

type Deps struct {
	DB         pg.DB
	Permission PermissionService
}

type Service struct {
	logger     *slog.Logger
	db         pg.DB
	permission PermissionService
}

func NewService(_ context.Context, logger *slog.Logger, deps *Deps) *Service {
	return &Service{logger: logger.With(slog.String("service", "reference")), db: deps.DB, permission: deps.Permission}
}

// Query is normalized by the transport. Limit must be explicit, from 1 to 100.
type Query struct {
	ProjectID   string
	Environment string
	SecretPath  string
	Offset      int
	Limit       int
}

type Reference struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Version   int       `json:"version"`
	CreatedAt string    `json:"createdAt"`
	UpdatedAt string    `json:"updatedAt"`
}

type Page struct {
	Narration   string      `json:"narration"`
	ProjectID   string      `json:"projectId"`
	Environment string      `json:"environment"`
	SecretPath  string      `json:"secretPath"`
	References  []Reference `json:"references"`
	NextOffset  *int        `json:"nextOffset"`
}

var (
	projectIDPattern   = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	environmentPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	folderPattern      = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

func (q Query) segments() ([]string, error) {
	if !projectIDPattern.MatchString(q.ProjectID) || !environmentPattern.MatchString(q.Environment) ||
		!strings.HasPrefix(q.SecretPath, "/") || len(q.SecretPath) > 1024 || q.Offset < 0 || q.Offset > 1000000 || q.Limit < 1 || q.Limit > 100 {
		return nil, errutil.BadRequest("Choose a project, environment and folder, with a page size from 1 to 100.")
	}
	segments := make([]string, 0)
	for _, segment := range strings.Split(q.SecretPath, "/") {
		if segment == "" {
			continue
		}
		if !folderPattern.MatchString(segment) {
			return nil, errutil.BadRequest("Invalid secret folder path.")
		}
		segments = append(segments, segment)
	}
	return segments, nil
}

func authenticatedActor(ctx context.Context) (*auth.Identity, error) {
	identity, err := auth.IdentityFromContext(ctx)
	if err != nil {
		return nil, err
	}
	user := identity.Actor == auth.ActorTypeUser && identity.AuthMode == auth.AuthModeJWT
	machine := identity.Actor == auth.ActorTypeIdentity && identity.AuthMode == auth.AuthModeIdentityAccessToken
	if identity.ActorID == uuid.Nil || identity.OrgID == uuid.Nil || (!user && !machine) {
		return nil, errutil.Unauthorized("Sign in to access your vault.")
	}
	return identity, nil
}

// List resolves authority before any reference lookup. Permission filtering is
// after physical pagination, preserving empty filtered pages and nextOffset.
func (s *Service) List(ctx context.Context, query Query) (*Page, error) {
	identity, err := authenticatedActor(ctx)
	if err != nil {
		return nil, err
	}
	segments, err := query.segments()
	if err != nil {
		return nil, err
	}
	if s.permission == nil || s.db == nil {
		return nil, errutil.InternalServer("Reference service is unavailable.")
	}
	resolved, err := s.permission.GetProjectPermission(ctx, &permission.GetProjectPermissionArgs{
		Actor: identity.Actor, ActorID: identity.ActorID, ActorOrgID: identity.OrgID,
		ActorAuthMethod: identity.AuthMethod, ProjectID: query.ProjectID,
		ActionProjectType: permission.ActionProjectTypeSecretManager,
	})
	if err != nil {
		return nil, err
	}
	if resolved == nil || resolved.Permission.Ability == nil {
		return nil, errutil.InternalServer("Reference authority is unavailable.")
	}
	checker := permsecret.NewSecretAccessChecker(resolved.Permission.Ability)
	if !checker.CanDescribeSecrets() {
		return nil, errutil.Forbidden("This resource is unavailable.")
	}
	folderID, err := s.findFolder(ctx, query, segments)
	if err != nil {
		return nil, err
	}
	rows, err := s.readPage(ctx, folderID, query.Offset, query.Limit+1)
	if err != nil {
		return nil, err
	}
	page := &Page{Narration: "These secret names are safe to reference. Their values stay in your vault.",
		ProjectID: query.ProjectID, Environment: query.Environment, SecretPath: query.SecretPath,
		References: make([]Reference, 0, query.Limit)}
	if len(rows) > query.Limit {
		next := query.Offset + query.Limit
		page.NextOffset = &next
		rows = rows[:query.Limit]
	}
	for _, row := range rows {
		if checker.CanDescribeSecret(query.Environment, query.SecretPath, row.Name, row.tags) {
			page.References = append(page.References, Reference{ID: row.ID, Name: row.Name, Version: row.Version,
				CreatedAt: row.createdAt.UTC().Format("2006-01-02T15:04:05.000Z"), UpdatedAt: row.updatedAt.UTC().Format("2006-01-02T15:04:05.000Z")})
		}
	}
	return page, nil
}

type referenceRow struct {
	ID        uuid.UUID
	Name      string
	Version   int
	createdAt time.Time
	updatedAt time.Time
	tags      []string
}

func (s *Service) readPage(ctx context.Context, folderID uuid.UUID, offset, limit int) ([]referenceRow, error) {
	// Tags affect authority. Read them with the page in one primary statement;
	// no query here selects a value, ciphertext, comment or custom metadata.
	rows, err := s.db.Primary().Query(ctx, `
		WITH page AS (
			SELECT id, key, version, "createdAt", "updatedAt"
			FROM secrets_v2 WHERE "folderId" = @folderID AND type = 'shared' AND "userId" IS NULL
			ORDER BY key, id OFFSET @offset LIMIT @limit
		)
		SELECT page.id, page.key, page.version, page."createdAt", page."updatedAt",
			ARRAY(SELECT tag.slug FROM secret_v2_tag_junction junction
				JOIN secret_tags tag ON tag.id = junction."secret_tagsId"
				WHERE junction."secrets_v2Id" = page.id ORDER BY tag.slug)
		FROM page ORDER BY page.key, page.id`, pgx.NamedArgs{"folderID": folderID, "offset": offset, "limit": limit})
	if err != nil {
		return nil, errutil.DatabaseErr("Could not read secret references.").WithErrf("reference.readPage: %w", err)
	}
	result, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (referenceRow, error) {
		var item referenceRow
		err := row.Scan(&item.ID, &item.Name, &item.Version, &item.createdAt, &item.updatedAt, &item.tags)
		return item, err
	})
	if err != nil {
		return nil, errutil.DatabaseErr("Could not read secret references.").WithErrf("reference.readPage rows: %w", err)
	}
	return result, nil
}
