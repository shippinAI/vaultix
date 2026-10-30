package nomen

import (
	"context"
	"crypto/fips140"
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

type IdentityAction string

const (
	IdentityLink   IdentityAction = "link"
	IdentityRevoke IdentityAction = "revoke"
)

type IdentityIntent struct {
	Action    IdentityAction
	BindingID uuid.UUID
	Issuer    string
}

var (
	ErrReauthenticationMethod   = errors.New("this account requires a reauthentication method that is not available for native identity linking yet")
	ErrReauthenticationBusy     = errors.New("reauthentication is busy; wait before trying again")
	ErrReauthenticationAttempts = errors.New("too many reauthentication attempts; wait five minutes before trying again")
)

type PasswordReauthenticationDeps struct {
	DB     pg.DB
	Issuer string
}

// PasswordReauthentication owns the local-password method only. MFA, federation,
// disabled password login and absent organization context fail closed. This does
// not enable a public route or replace the existing login/MFA flows.
type PasswordReauthentication struct {
	db     pg.DB
	issuer string
	logger *slog.Logger
	slots  chan struct{}
}

type ReauthenticationProof struct {
	Code      string `json:"-"`
	ExpiresAt time.Time
}

func (ReauthenticationProof) String() string   { return "reauthentication proof (redacted)" }
func (ReauthenticationProof) GoString() string { return "reauthentication proof (redacted)" }

func NewPasswordReauthentication(_ context.Context, logger *slog.Logger, deps *PasswordReauthenticationDeps) (*PasswordReauthentication, error) {
	if deps == nil || deps.DB == nil || logger == nil {
		return nil, ErrConfiguration
	}
	if _, err := secureURL(deps.Issuer); err != nil {
		return nil, ErrConfiguration
	}
	if fips140.Enabled() {
		return nil, ErrReauthenticationMethod
	}
	return &PasswordReauthentication{db: deps.DB, issuer: deps.Issuer, logger: logger, slots: make(chan struct{}, 2)}, nil
}

func (s *PasswordReauthentication) validateIntent(intent IdentityIntent) error {
	if intent.Issuer != s.issuer {
		return ErrLinkDenied
	}
	switch intent.Action {
	case IdentityLink:
		if intent.BindingID != uuid.Nil {
			return ErrLinkDenied
		}
	case IdentityRevoke:
		if intent.BindingID == uuid.Nil {
			return ErrLinkDenied
		}
	default:
		return ErrLinkDenied
	}
	return nil
}

func (s *PasswordReauthentication) transaction(ctx context.Context, fn func(context.Context, pgx.Tx) error) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return pgx.BeginFunc(ctx, s.db.Primary(), func(tx pgx.Tx) error { return fn(ctx, tx) })
}

// credential locks only database rows. Expensive password verification happens
// between transactions; the current account, session, policy and hash are checked
// again before issuing or consuming a proof.
func (s *PasswordReauthentication) credential(ctx context.Context, tx pgx.Tx, actor *auth.Identity, intent IdentityIntent) (string, error) {
	if actor.SessionAccessVersion == nil || actor.OrgID == uuid.Nil || actor.RootOrgID == uuid.Nil {
		return "", ErrLinkDenied
	}
	if err := lockAccount(ctx, tx, actor, *actor.SessionAccessVersion); err != nil {
		return "", err
	}
	var encoded string
	var passwordAllowed, mfaEnabled bool
	err := tx.QueryRow(ctx, `SELECT COALESCE("hashedPassword",''),COALESCE('email'=ANY("authMethods"),false) AND "isEmailVerified" IS TRUE,"isMfaEnabled" IS TRUE FROM users WHERE id=$1`, actor.ActorID).Scan(&encoded, &passwordAllowed, &mfaEnabled)
	if err != nil {
		return "", err
	}
	if !passwordAllowed || encoded == "" || mfaEnabled || actor.AuthMethod != "email" {
		return "", ErrReauthenticationMethod
	}
	rows, err := tx.Query(ctx, `SELECT id,COALESCE("rootOrgId",id),"enforceMfa" IS TRUE,"authEnforced" IS TRUE FROM organizations WHERE id=$1 OR id=$2 ORDER BY id FOR SHARE`, actor.OrgID, actor.RootOrgID)
	if err != nil {
		return "", err
	}
	foundOrg, foundRoot, allowed := false, false, true
	for rows.Next() {
		var id, root uuid.UUID
		var orgMfa, federated bool
		if err := rows.Scan(&id, &root, &orgMfa, &federated); err != nil {
			rows.Close()
			return "", err
		}
		if id == actor.OrgID {
			foundOrg = root == actor.RootOrgID
		}
		if id == actor.RootOrgID {
			foundRoot = true
		}
		allowed = allowed && !orgMfa && !federated
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}
	if !foundOrg || !foundRoot {
		return "", ErrLinkDenied
	}
	if !allowed {
		return "", ErrReauthenticationMethod
	}
	var emailEnabled, fipsEnabled bool
	err = tx.QueryRow(ctx, `SELECT "enabledLoginMethods" IS NULL OR 'email'=ANY("enabledLoginMethods"),"fipsEnabled" FROM super_admin WHERE initialized IS TRUE ORDER BY id LIMIT 1 FOR SHARE`).Scan(&emailEnabled, &fipsEnabled)
	if err != nil {
		return "", err
	}
	if !emailEnabled || fipsEnabled {
		return "", ErrReauthenticationMethod
	}
	if intent.Action == IdentityRevoke {
		var owned bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vaultix_identity_bindings WHERE id=$1 AND "userId"=$2 AND issuer=$3)`, intent.BindingID, actor.ActorID, s.issuer).Scan(&owned)
		if err != nil {
			return "", err
		}
		if !owned {
			return "", ErrLinkDenied
		}
	}
	return encoded, nil
}

func (s *PasswordReauthentication) Authenticate(ctx context.Context, intent IdentityIntent, password string) (*ReauthenticationProof, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	actor, err := linkingActor(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.validateIntent(intent); err != nil {
		return nil, err
	}
	if password == "" || len(password) > 1024 {
		return nil, ErrLinkDenied
	}
	var encoded string
	err = s.transaction(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		encoded, err = s.credential(ctx, tx, actor, intent)
		if err != nil {
			return err
		}
		var attempts int
		err = tx.QueryRow(ctx, `INSERT INTO vaultix_identity_reauth_attempts ("userId",attempts) VALUES($1,1)
   ON CONFLICT ("userId") DO UPDATE SET attempts=CASE WHEN vaultix_identity_reauth_attempts."windowStartedAt"<=clock_timestamp()-interval '5 minutes' THEN 1 ELSE vaultix_identity_reauth_attempts.attempts+1 END,
   "windowStartedAt"=CASE WHEN vaultix_identity_reauth_attempts."windowStartedAt"<=clock_timestamp()-interval '5 minutes' THEN clock_timestamp() ELSE vaultix_identity_reauth_attempts."windowStartedAt" END
   WHERE vaultix_identity_reauth_attempts.attempts<5 OR vaultix_identity_reauth_attempts."windowStartedAt"<=clock_timestamp()-interval '5 minutes'
   RETURNING attempts`, actor.ActorID).Scan(&attempts)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrReauthenticationAttempts
		}
		return err
	})
	if err != nil {
		return nil, s.failure(ctx, err)
	}
	if err := verifyPassword(ctx, s.slots, password, encoded); err != nil {
		return nil, err
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, ErrBindingUnavailable
	}
	code := base64.RawURLEncoding.EncodeToString(random[:])
	digest, policy := sha256.Sum256([]byte(code)), sha256.Sum256([]byte(encoded))
	var expires time.Time
	err = s.transaction(ctx, func(ctx context.Context, tx pgx.Tx) error {
		current, err := s.credential(ctx, tx, actor, intent)
		if err != nil {
			return err
		}
		if current != encoded {
			return ErrLinkDenied
		}
		var target *uuid.UUID
		if intent.BindingID != uuid.Nil {
			target = &intent.BindingID
		}
		return tx.QueryRow(ctx, `INSERT INTO vaultix_identity_reauth_proofs ("userId",id,digest,issuer,action,"bindingId","sessionId","accessVersion","orgId","policyDigest","authenticatedAt","expiresAt")
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,statement_timestamp(),statement_timestamp()+interval '5 minutes')
   ON CONFLICT ("userId") DO UPDATE SET id=EXCLUDED.id,digest=EXCLUDED.digest,issuer=EXCLUDED.issuer,action=EXCLUDED.action,"bindingId"=EXCLUDED."bindingId","sessionId"=EXCLUDED."sessionId","accessVersion"=EXCLUDED."accessVersion","orgId"=EXCLUDED."orgId","policyDigest"=EXCLUDED."policyDigest","consumedAt"=NULL,"authenticatedAt"=EXCLUDED."authenticatedAt","expiresAt"=EXCLUDED."expiresAt"
   RETURNING "expiresAt"`, actor.ActorID, uuid.New(), digest[:], s.issuer, intent.Action, target, actor.TokenVersionID, *actor.SessionAccessVersion, actor.OrgID, policy[:]).Scan(&expires)
	})
	if err != nil {
		return nil, s.failure(ctx, err)
	}
	return &ReauthenticationProof{Code: code, ExpiresAt: expires}, nil
}

func (s *PasswordReauthentication) VerifyIdentityAction(ctx context.Context, tx pgx.Tx, identity *auth.Identity, proof string, intent IdentityIntent) (*LinkAuthorization, error) {
	actor, err := linkingActor(ctx)
	if err != nil || identity == nil || actor != identity || tx == nil {
		return nil, ErrLinkDenied
	}
	if err := s.validateIntent(intent); err != nil {
		return nil, err
	}
	if len(proof) != 43 {
		return nil, ErrLinkDenied
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(proof)
	if err != nil || len(decoded) != 32 {
		return nil, ErrLinkDenied
	}
	encoded, err := s.credential(ctx, tx, actor, intent)
	if err != nil {
		return nil, s.failure(ctx, err)
	}
	digest, policy := sha256.Sum256([]byte(proof)), sha256.Sum256([]byte(encoded))
	authorization := new(LinkAuthorization)
	var target *uuid.UUID
	if intent.BindingID != uuid.Nil {
		target = &intent.BindingID
	}
	err = tx.QueryRow(ctx, `UPDATE vaultix_identity_reauth_proofs SET "consumedAt"=clock_timestamp() WHERE "userId"=$1 AND "schemaVersion"=1 AND digest=$2 AND issuer=$3 AND action=$4 AND "bindingId" IS NOT DISTINCT FROM $5::uuid AND "sessionId"=$6 AND "accessVersion"=$7 AND "orgId"=$8 AND "policyDigest"=$9 AND "authenticatedAt"<=clock_timestamp() AND "expiresAt">clock_timestamp() AND "consumedAt" IS NULL
   RETURNING id,"accessVersion","authenticatedAt"`, actor.ActorID, digest[:], s.issuer, intent.Action, target, actor.TokenVersionID, *actor.SessionAccessVersion, actor.OrgID, policy[:]).Scan(&authorization.ProofID, &authorization.AccessVersion, &authorization.AuthenticatedAt)
	if err != nil {
		return nil, s.failure(ctx, err)
	}
	return authorization, nil
}

func (s *PasswordReauthentication) ValidateIdentityAction(ctx context.Context, tx pgx.Tx, identity *auth.Identity, proofID uuid.UUID, intent IdentityIntent) error {
	actor, err := linkingActor(ctx)
	if err != nil || identity == nil || actor != identity || tx == nil || proofID == uuid.Nil {
		return ErrLinkDenied
	}
	if err := s.validateIntent(intent); err != nil {
		return err
	}
	encoded, err := s.credential(ctx, tx, actor, intent)
	if err != nil {
		return s.failure(ctx, err)
	}
	policy := sha256.Sum256([]byte(encoded))
	var target *uuid.UUID
	if intent.BindingID != uuid.Nil {
		target = &intent.BindingID
	}
	var valid bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vaultix_identity_reauth_proofs WHERE "userId"=$1 AND id=$2 AND "schemaVersion"=1 AND issuer=$3 AND action=$4 AND "bindingId" IS NOT DISTINCT FROM $5::uuid AND "sessionId"=$6 AND "accessVersion"=$7 AND "orgId"=$8 AND "policyDigest"=$9 AND "authenticatedAt"<=clock_timestamp() AND "expiresAt">clock_timestamp() AND "consumedAt" IS NOT NULL)`, actor.ActorID, proofID, s.issuer, intent.Action, target, actor.TokenVersionID, *actor.SessionAccessVersion, actor.OrgID, policy[:]).Scan(&valid)
	if err != nil {
		return s.failure(ctx, err)
	}
	if !valid {
		return ErrLinkDenied
	}
	return nil
}

func (s *PasswordReauthentication) failure(ctx context.Context, err error) error {
	switch {
	case errors.Is(err, ErrReauthenticationMethod), errors.Is(err, ErrReauthenticationAttempts), errors.Is(err, ErrLinkDenied):
		return err
	case errors.Is(err, pgx.ErrNoRows):
		return ErrLinkDenied
	default:
		s.logger.ErrorContext(ctx, "Identity reauthentication is unavailable")
		return ErrBindingUnavailable
	}
}
