// Package session owns a user's view of their own sign-in sessions.
package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/services/auth"
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
	DB         pg.DB
	AuthSecret string
	KeyStore   keystore.KeyStore
}

type Service struct {
	db     pg.DB
	secret []byte
	keys   keystore.KeyStore
}

func NewService(deps *Deps) (*Service, error) {
	if deps == nil || deps.DB == nil || deps.AuthSecret == "" || deps.KeyStore == nil {
		return nil, errors.New("session service requires a database, auth secret and key store")
	}
	return &Service{db: deps.DB, secret: []byte(deps.AuthSecret), keys: deps.KeyStore}, nil
}

// refreshClaims is the browser refresh token the application issues. A missing
// refreshVersion stays nil so it can never match a session's version.
type refreshClaims struct {
	jwt.RegisteredClaims
	AuthTokenType  auth.AuthTokenType `json:"authTokenType"`
	UserID         uuid.UUID          `json:"userId"`
	TokenVersionID uuid.UUID          `json:"tokenVersionId"`
	RefreshVersion *int64             `json:"refreshVersion"`
	OAuthClientID  json.RawMessage    `json:"oauthClientId"`
}

func graceKey(sessionID uuid.UUID) string {
	return "refresh-token-grace:" + sessionID.String()
}

// Logout ends the session a refresh token belongs to. A token that proves nothing
// changes nothing, because the caller clears the browser's cookies either way.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	claims := &refreshClaims{}
	_, err := jwt.ParseWithClaims(refreshToken, claims, func(*jwt.Token) (any, error) { return s.secret, nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || claims.AuthTokenType != auth.AuthTokenTypeRefreshToken || len(claims.OAuthClientID) > 0 {
		return nil
	}
	args := pgx.NamedArgs{"id": claims.TokenVersionID, "user": claims.UserID}
	var current int64
	err = s.db.Primary().QueryRow(ctx, `SELECT "refreshVersion" FROM vx_auth_sessions WHERE id = @id AND "userId" = @user`, args).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find session: %w", err)
	}
	key := graceKey(claims.TokenVersionID)
	if claims.RefreshVersion == nil || *claims.RefreshVersion != current {
		accepted, err := s.withinGrace(ctx, key, claims.RefreshVersion, current)
		if err != nil {
			return err
		}
		if !accepted {
			// An old token outside the grace window may be stolen, so the session ends.
			if _, err := s.db.Primary().Exec(ctx, `DELETE FROM vx_auth_sessions WHERE id = @id AND "userId" = @user`, args); err != nil {
				return fmt.Errorf("revoke reused session: %w", err)
			}
			return s.clearGrace(ctx, key)
		}
	}
	if _, err := s.db.Primary().Exec(ctx, `UPDATE vx_auth_sessions SET "accessVersion" = "accessVersion" + 1, "refreshVersion" = "refreshVersion" + 1 WHERE id = @id AND "userId" = @user`, args); err != nil {
		return fmt.Errorf("end session: %w", err)
	}
	return s.clearGrace(ctx, key)
}

// withinGrace accepts the immediately previous token for a few seconds after a
// rotation, because another browser tab can still be holding it.
func (s *Service) withinGrace(ctx context.Context, key string, presented *int64, current int64) (bool, error) {
	value, err := s.keys.GetItem(ctx, key)
	if err != nil {
		return false, fmt.Errorf("read refresh grace: %w", err)
	}
	if value == "" || presented == nil {
		return false, nil
	}
	remembered, err := strconv.ParseInt(value, 10, 64)
	return err == nil && remembered == *presented && current == *presented+1, nil
}

func (s *Service) clearGrace(ctx context.Context, key string) error {
	if _, err := s.keys.DeleteItem(ctx, key); err != nil {
		return fmt.Errorf("clear refresh grace: %w", err)
	}
	return nil
}

// List returns the user's sessions, most recently used first.
func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Session, error) {
	rows, err := s.db.Replica().Query(ctx, `SELECT id, ip, "userAgent", "refreshVersion", "accessVersion", "lastUsed", "createdAt", "updatedAt", "userId"
 FROM vx_auth_sessions WHERE "userId" = @user ORDER BY "lastUsed" DESC`, pgx.NamedArgs{"user": userID})
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
	_, err := s.db.Primary().Exec(ctx, `DELETE FROM vx_auth_sessions WHERE "userId" = @user AND id = @id`, pgx.NamedArgs{"user": userID, "id": sessionID})
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

// RevokeAll removes every session the user has, including the calling one.
func (s *Service) RevokeAll(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.Primary().Exec(ctx, `DELETE FROM vx_auth_sessions WHERE "userId" = @user`, pgx.NamedArgs{"user": userID})
	if err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	return nil
}
