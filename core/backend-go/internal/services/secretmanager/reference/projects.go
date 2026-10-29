package reference

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
)

type Environment struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Slug string    `json:"slug"`
}

type Project struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Slug         string        `json:"slug"`
	Environments []Environment `json:"environments"`
}

type Projects struct {
	Narration string    `json:"narration"`
	Projects  []Project `json:"projects"`
}

// ListProjects preserves explicit direct/group membership visibility. As in
// the existing action, an assumed project grant does not replace the requester
// for organization-wide project discovery. Reading references still resolves
// project permissions, SSO and assumed authority independently.
func (s *Service) ListProjects(ctx context.Context) (*Projects, error) {
	actor, err := authenticatedActor(ctx)
	if err != nil {
		return nil, err
	}
	if s.db == nil {
		return nil, errutil.InternalServer("Reference service is unavailable.")
	}
	rows, err := s.db.Primary().Query(ctx, `
		SELECT project.id, project.name, project.slug, env.id, env.name, env.slug
		FROM projects project
		LEFT JOIN project_environments env ON env."projectId" = project.id AND env."deleteAfter" IS NULL
		WHERE project."orgId" = @orgID AND project.type = 'secret-manager' AND project."deleteAfter" IS NULL
			AND EXISTS (
				SELECT 1 FROM memberships membership
				WHERE membership.scope = 'project' AND membership."scopeProjectId" = project.id AND (
					(@isUser AND membership."actorUserId" = @actorID) OR
					(NOT @isUser AND membership."actorIdentityId" = @actorID) OR
					EXISTS (
						SELECT 1 FROM groups actor_group
						WHERE actor_group.id = membership."actorGroupId" AND actor_group."orgId" = @orgID AND (
							(@isUser AND EXISTS (SELECT 1 FROM user_group_membership link WHERE link."groupId" = actor_group.id AND link."userId" = @actorID)) OR
							(NOT @isUser AND EXISTS (SELECT 1 FROM identity_group_membership link WHERE link."groupId" = actor_group.id AND link."identityId" = @actorID))
						)
					)
				)
			)
		ORDER BY project.name, project.id, env.position, env.id`, pgx.NamedArgs{
		"orgID": actor.OrgID, "actorID": actor.ActorID, "isUser": actor.Actor == auth.ActorTypeUser,
	})
	if err != nil {
		return nil, errutil.DatabaseErr("Could not list projects.").WithErrf("reference.ListProjects: %w", err)
	}
	defer rows.Close()
	result := &Projects{Narration: "These are the apps you can access in this organization.", Projects: make([]Project, 0)}
	indices := make(map[string]int)
	for rows.Next() {
		var project Project
		var envID sql.Null[uuid.UUID]
		var envName, envSlug sql.NullString
		if err := rows.Scan(&project.ID, &project.Name, &project.Slug, &envID, &envName, &envSlug); err != nil {
			return nil, errutil.DatabaseErr("Could not list projects.").WithErrf("reference.ListProjects row: %w", err)
		}
		index, ok := indices[project.ID]
		if !ok {
			index = len(result.Projects)
			indices[project.ID] = index
			project.Environments = make([]Environment, 0)
			result.Projects = append(result.Projects, project)
		}
		if envID.Valid {
			result.Projects[index].Environments = append(result.Projects[index].Environments, Environment{ID: envID.V, Name: envName.String, Slug: envSlug.String})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, errutil.DatabaseErr("Could not list projects.").WithErrf("reference.ListProjects rows: %w", err)
	}
	return result, nil
}
