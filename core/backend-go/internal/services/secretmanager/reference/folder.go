package reference

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/libs/errutil"
)

func (s *Service) findFolder(ctx context.Context, query Query, segments []string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.db.Primary().QueryRow(ctx, `
		WITH RECURSIVE path AS (
			SELECT folder.id, folder."envId", 0 AS depth
			FROM secret_folders folder JOIN project_environments env ON env.id = folder."envId"
			WHERE env."projectId" = @projectID AND env.slug = @environment AND env."deleteAfter" IS NULL
				AND folder."parentId" IS NULL
			UNION ALL
			SELECT child.id, child."envId", path.depth + 1
			FROM path JOIN secret_folders child ON child."parentId" = path.id AND child."envId" = path."envId"
			WHERE path.depth < cardinality(@segments::text[]) AND child.name = (@segments::text[])[path.depth + 1]
		)
		SELECT id FROM path WHERE depth = cardinality(@segments::text[]) LIMIT 1`,
		pgx.NamedArgs{"projectID": query.ProjectID, "environment": query.Environment, "segments": segments}).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, errutil.NotFound("This secret folder is unavailable.")
	}
	if err != nil {
		return uuid.Nil, errutil.DatabaseErr("Could not resolve the secret folder.").WithErrf("reference.findFolder: %w", err)
	}
	return id, nil
}
