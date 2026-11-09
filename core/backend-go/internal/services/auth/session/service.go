// Package session owns a user's view of their own sign-in sessions.
package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/database/pg"
)

// Session is one row of a user's sessions. Browser and device sessions share
// the table, and the session type stays internal.
type Session struct {
	ID             uuid.UUID
	IP             string
	UserAgent      *string
	RefreshVersion int64
	AccessVersion  int64
	LastUsed       time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
	UserID         uuid.UUID
}

type Deps struct {
	DB pg.DB
}

type Service struct {
	db pg.DB
}

func NewService(deps *Deps) (*Service, error) {
	if deps == nil || deps.DB == nil {
		return nil, errors.New("session service requires a database")
	}
	return &Service{db: deps.DB}, nil
}

// List returns the user's sessions, most recently used first.
func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Session, error) {
	rows, err := s.db.Replica().Query(ctx, `SELECT id, ip, "userAgent", "refreshVersion", "accessVersion", "lastUsed", "createdAt", "updatedAt", "userId"
 FROM auth_token_sessions WHERE "userId" = @user ORDER BY "lastUsed" DESC`, pgx.NamedArgs{"user": userID})
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	sessions, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Session])
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	return sessions, nil
}

// Revoke removes one of the user's sessions. An ID the user does not own, or
// one already gone, changes nothing and is not an error.
func (s *Service) Revoke(ctx context.Context, userID, sessionID uuid.UUID) error {
	_, err := s.db.Primary().Exec(ctx, `DELETE FROM auth_token_sessions WHERE "userId" = @user AND id = @id`, pgx.NamedArgs{"user": userID, "id": sessionID})
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

// RevokeAll removes every session the user has, including the calling one.
func (s *Service) RevokeAll(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.Primary().Exec(ctx, `DELETE FROM auth_token_sessions WHERE "userId" = @user`, pgx.NamedArgs{"user": userID})
	if err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	return nil
}
