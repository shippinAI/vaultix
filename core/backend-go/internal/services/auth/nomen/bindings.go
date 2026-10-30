package nomen

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/services/auth"
)

var (
	ErrLinkDenied         = errors.New("identity linking could not be verified; sign in again and restart")
	ErrBindingConflict    = errors.New("this identity cannot be linked to this account")
	ErrBindingUnavailable = errors.New("identity linking is temporarily unavailable")
)

// FreshAuthentication must verify a recent, intent-bound reauthentication proof
// for this first-party user/session, including required MFA. Ordinary session
// validity or a caller-supplied timestamp does not satisfy this contract.
// No production adapter/route is enabled by this persistence component.
type FreshAuthentication interface {
	VerifyIdentityLink(ctx context.Context, identity *auth.Identity, proof string) (*LinkAuthorization, error)
}

type LinkAuthorization struct {
	AccessVersion   int64
	AuthenticatedAt time.Time
}

type AccessIntrospector interface {
	Introspect(ctx context.Context, token string) (*Claims, error)
}

type BindingDeps struct {
	DB                  pg.DB
	Issuer              string
	FreshAuthentication FreshAuthentication
	Introspection       AccessIntrospector
}

type BindingService struct {
	db            pg.DB
	issuer        string
	fresh         FreshAuthentication
	introspection AccessIntrospector
	logger        *slog.Logger
}

type LinkChallenge struct {
	Code      string `json:"-"`
	ExpiresAt time.Time
}

func (LinkChallenge) String() string   { return "identity link challenge (redacted)" }
func (LinkChallenge) GoString() string { return "identity link challenge (redacted)" }

func NewBindingService(_ context.Context, logger *slog.Logger, deps *BindingDeps) (*BindingService, error) {
	if deps == nil || logger == nil || deps.DB == nil || deps.FreshAuthentication == nil || deps.Introspection == nil {
		return nil, ErrConfiguration
	}
	if _, err := secureURL(deps.Issuer); err != nil {
		return nil, ErrConfiguration
	}
	return &BindingService{db: deps.DB, issuer: deps.Issuer, fresh: deps.FreshAuthentication, introspection: deps.Introspection, logger: logger}, nil
}

func linkingActor(ctx context.Context) (*auth.Identity, error) {
	actor, err := auth.IdentityFromContext(ctx)
	if err != nil || actor.AuthMode != auth.AuthModeJWT || actor.Actor != auth.ActorTypeUser || actor.ActorID == uuid.Nil || actor.TokenVersionID == uuid.Nil || auth.AssumedPrivilegeFromContext(ctx) != nil {
		return nil, ErrLinkDenied
	}
	return actor, nil
}

func (s *BindingService) freshProof(ctx context.Context, actor *auth.Identity, proof string) (*LinkAuthorization, error) {
	if !identifier(proof, maxTokenBytes) {
		return nil, ErrLinkDenied
	}
	authorization, err := s.fresh.VerifyIdentityLink(ctx, actor, proof)
	now := time.Now()
	if err != nil || authorization == nil || authorization.AccessVersion < 0 || authorization.AuthenticatedAt.Before(now.Add(-5*time.Minute)) || authorization.AuthenticatedAt.After(now.Add(30*time.Second)) {
		return nil, ErrLinkDenied
	}
	return authorization, nil
}

// BeginLink authorizes only a short-lived linking intent, never API access.
// One outstanding challenge per user bounds storage and supersedes old attempts.
func (s *BindingService) BeginLink(ctx context.Context, proof string) (*LinkChallenge, error) {
	actor, err := linkingActor(ctx)
	if err != nil {
		return nil, err
	}
	authorization, err := s.freshProof(ctx, actor, proof)
	if err != nil {
		return nil, err
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, ErrBindingUnavailable
	}
	code := base64.RawURLEncoding.EncodeToString(random[:])
	digest := sha256.Sum256([]byte(code))
	var expires time.Time
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = pgx.BeginFunc(ctx, s.db.Primary(), func(tx pgx.Tx) error {
		if err := s.lockAccount(ctx, tx, actor, authorization.AccessVersion); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
   INSERT INTO vaultix_identity_link_challenges ("userId",id,digest,issuer,"sessionId","accessVersion","createdAt","expiresAt")
   VALUES ($1,$2,$3,$4,$5,$6,statement_timestamp(),LEAST(statement_timestamp()+interval '5 minutes',$7))
   ON CONFLICT ("userId") DO UPDATE SET id=EXCLUDED.id,digest=EXCLUDED.digest,issuer=EXCLUDED.issuer,
    "sessionId"=EXCLUDED."sessionId","accessVersion"=EXCLUDED."accessVersion","createdAt"=EXCLUDED."createdAt","expiresAt"=EXCLUDED."expiresAt"
   RETURNING "expiresAt"`, actor.ActorID, uuid.New(), digest[:], s.issuer, actor.TokenVersionID, authorization.AccessVersion, authorization.AuthenticatedAt.Add(5*time.Minute)).Scan(&expires)
	})
	if err != nil {
		return nil, s.failure(ctx, err)
	}
	return &LinkChallenge{Code: code, ExpiresAt: expires}, nil
}

// CompleteLink validates the provider before opening a transaction. The intent
// is consumed in the same transaction as ownership and provenance. A binding
// lookup is not a tenant grant, and this method never creates a local session.
func (s *BindingService) CompleteLink(ctx context.Context, code, accessToken string) (uuid.UUID, error) {
	actor, err := linkingActor(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	decoded, err := base64.RawURLEncoding.DecodeString(code)
	if err != nil || len(decoded) != 32 || len(code) != 43 {
		return uuid.Nil, ErrLinkDenied
	}
	digest := sha256.Sum256([]byte(code))
	var version int64
	var proofID uuid.UUID
	err = s.db.Primary().QueryRow(ctx, `SELECT "accessVersion",id FROM vaultix_identity_link_challenges
  WHERE "userId"=$1 AND "sessionId"=$2 AND issuer=$3 AND digest=$4 AND "expiresAt">clock_timestamp()`, actor.ActorID, actor.TokenVersionID, s.issuer, digest[:]).Scan(&version, &proofID)
	if err != nil {
		return uuid.Nil, s.failure(ctx, err)
	}
	claims, err := s.introspection.Introspect(ctx, accessToken)
	if err != nil {
		return uuid.Nil, err
	}
	if claims == nil || claims.Issuer != s.issuer || !identifier(claims.Subject, 255) || !claims.ExpiresAt.After(time.Now()) {
		return uuid.Nil, ErrLinkDenied
	}
	var bindingID uuid.UUID
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = pgx.BeginFunc(ctx, s.db.Primary(), func(tx pgx.Tx) error {
		if err := s.lockAccount(ctx, tx, actor, version); err != nil {
			return err
		}
		if !claims.ExpiresAt.After(time.Now()) {
			return ErrLinkDenied
		}
		// The second check serializes replay/supersession and expiry during provider I/O.
		tag, err := tx.Exec(ctx, `DELETE FROM vaultix_identity_link_challenges WHERE "userId"=$1 AND id=$2
   AND digest=$3 AND "sessionId"=$4 AND "expiresAt">clock_timestamp()`, actor.ActorID, proofID, digest[:], actor.TokenVersionID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return ErrLinkDenied
		}
		var inserted uuid.UUID
		err = tx.QueryRow(ctx, `INSERT INTO vaultix_identity_bindings (issuer,subject,"userId","proofId","sessionId")
   VALUES ($1,$2,$3,$4,$5) ON CONFLICT (issuer,subject) DO NOTHING RETURNING id`, s.issuer, claims.Subject, actor.ActorID, proofID, actor.TokenVersionID).Scan(&inserted)
		if err == nil {
			bindingID = inserted
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		// A deleted account's NULL ownership is a permanent tombstone, never claimable.
		err = tx.QueryRow(ctx, `UPDATE vaultix_identity_bindings SET "revokedAt"=NULL,"proofId"=$1,"sessionId"=$2
   WHERE issuer=$3 AND subject=$4 AND "userId"=$5 RETURNING id`, proofID, actor.TokenVersionID, s.issuer, claims.Subject, actor.ActorID).Scan(&bindingID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrBindingConflict
		}
		return err
	})
	if err != nil {
		return uuid.Nil, s.failure(ctx, err)
	}
	return bindingID, nil
}

func (s *BindingService) Revoke(ctx context.Context, bindingID uuid.UUID, proof string) error {
	actor, err := linkingActor(ctx)
	if err != nil {
		return err
	}
	if bindingID == uuid.Nil {
		return ErrLinkDenied
	}
	authorization, err := s.freshProof(ctx, actor, proof)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = pgx.BeginFunc(ctx, s.db.Primary(), func(tx pgx.Tx) error {
		if err := s.lockAccount(ctx, tx, actor, authorization.AccessVersion); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE vaultix_identity_bindings SET "revokedAt"=COALESCE("revokedAt",clock_timestamp()),"proofId"=$1,"sessionId"=$2
   WHERE id=$3 AND "userId"=$4 AND issuer=$5`, uuid.New(), actor.TokenVersionID, bindingID, actor.ActorID, s.issuer)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return ErrLinkDenied
		}
		return nil
	})
	if err != nil {
		return s.failure(ctx, err)
	}
	return nil
}

// Resolve returns only a bound user ID, not an authenticated actor. Callers must
// independently verify the provider token, account, tenant, MFA and permissions.
func (s *BindingService) Resolve(ctx context.Context, subject string) (uuid.UUID, error) {
	if !identifier(subject, 255) {
		return uuid.Nil, ErrLinkDenied
	}
	var userID uuid.UUID
	err := s.db.Primary().QueryRow(ctx, `SELECT b."userId" FROM vaultix_identity_bindings b JOIN users u ON u.id=b."userId"
  WHERE b.issuer=$1 AND b.subject=$2 AND b."revokedAt" IS NULL AND u."isAccepted" IS TRUE
   AND u."isGhost" IS FALSE AND u."isLocked" IS NOT TRUE
   AND (u."temporaryLockDateEnd" IS NULL OR u."temporaryLockDateEnd"<=clock_timestamp())`, s.issuer, subject).Scan(&userID)
	if err != nil {
		return uuid.Nil, s.failure(ctx, err)
	}
	return userID, nil
}

func (s *BindingService) lockAccount(ctx context.Context, tx pgx.Tx, actor *auth.Identity, version int64) error {
	var active bool
	err := tx.QueryRow(ctx, `SELECT "isAccepted" IS TRUE AND "isGhost" IS FALSE AND "isLocked" IS NOT TRUE
  AND ("temporaryLockDateEnd" IS NULL OR "temporaryLockDateEnd"<=clock_timestamp()) FROM users WHERE id=$1 FOR UPDATE`, actor.ActorID).Scan(&active)
	if err != nil {
		return err
	}
	if !active {
		return ErrLinkDenied
	}
	var currentVersion int64
	err = tx.QueryRow(ctx, `SELECT "accessVersion" FROM auth_token_sessions WHERE id=$1 AND "userId"=$2 FOR UPDATE`, actor.TokenVersionID, actor.ActorID).Scan(&currentVersion)
	if err != nil {
		return err
	}
	if currentVersion != version {
		return ErrLinkDenied
	}
	return nil
}

func (s *BindingService) failure(ctx context.Context, err error) error {
	if errors.Is(err, ErrLinkDenied) || errors.Is(err, pgx.ErrNoRows) {
		return ErrLinkDenied
	}
	if errors.Is(err, ErrBindingConflict) {
		return ErrBindingConflict
	}
	// SQL errors can contain issuer/subject/proof material. Keep diagnostics bounded.
	s.logger.ErrorContext(ctx, "Identity binding transaction failed")
	return ErrBindingUnavailable
}
