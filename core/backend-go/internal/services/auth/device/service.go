package device

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/services/auth"
)

const cleanupBatch = 128

type Deps struct {
	DB             pg.DB
	HashKey        []byte
	Resource       string
	MaxOutstanding int
	Authority      Authority
	SessionIssuer  SessionIssuer
}

type Service struct {
	db             pg.DB
	logger         *slog.Logger
	hashKey        []byte
	resource       string
	maxOutstanding int
	authority      Authority
	issuer         SessionIssuer
}

func NewService(_ context.Context, logger *slog.Logger, deps *Deps) (*Service, error) {
	if logger == nil || deps == nil || deps.DB == nil || len(deps.HashKey) < 32 ||
		!validResource(deps.Resource) || deps.Authority == nil || deps.SessionIssuer == nil ||
		deps.MaxOutstanding < 1 || deps.MaxOutstanding > 10000 {
		return nil, ErrUnavailable
	}
	return &Service{db: deps.DB, logger: logger, hashKey: append([]byte(nil), deps.HashKey...),
		resource: deps.Resource, maxOutstanding: deps.MaxOutstanding, authority: deps.Authority, issuer: deps.SessionIssuer}, nil
}

func (s *Service) validRequest(request Request) bool {
	return request.ClientID == ClientID && request.Resource == s.resource && request.Scope == Scope
}

func (s *Service) unavailable(ctx context.Context, operation string) error {
	// Driver errors may contain code digests, approval details or token values.
	s.logger.ErrorContext(ctx, "Vaultix device authorization failed", slog.String("operation", operation))
	return ErrUnavailable
}

func (s *Service) Start(ctx context.Context, request Request) (Grant, error) {
	if !s.validRequest(request) {
		return Grant{}, ErrInvalidRequest
	}
	deviceCode, userCode := newCodes()
	canonical, _ := canonicalUserCode(userCode)
	grant := Grant{ID: uuid.New(), DeviceCode: deviceCode, UserCode: userCode, Interval: Interval}
	deviceDigest, userDigest := s.digest("device-code", deviceCode), s.digest("user-code", canonical)
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return Grant{}, s.unavailable(ctx, "start")
	}
	defer tx.Rollback(ctx)
	// One bounded global admission owner across replicas; no network/crypto work
	// or request-controlled lock identity is held inside this transaction.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(2026103103)`); err != nil {
		return Grant{}, s.unavailable(ctx, "admission")
	}
	if _, err = cleanup(ctx, tx); err != nil {
		return Grant{}, s.unavailable(ctx, "cleanup")
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT id FROM vaultix_device_authorizations LIMIT @limit) bounded`, pgx.NamedArgs{"limit": s.maxOutstanding}).Scan(&count); err != nil {
		return Grant{}, s.unavailable(ctx, "admission")
	}
	if count >= s.maxOutstanding {
		if err = tx.Commit(ctx); err != nil {
			return Grant{}, s.unavailable(ctx, "admission")
		}
		return Grant{}, ErrUnavailable
	}
	err = tx.QueryRow(ctx, `WITH stamp AS (SELECT clock_timestamp() AS now)
 INSERT INTO vaultix_device_authorizations (id,"deviceDigest","userCodeDigest","clientId",resource,scope,"createdAt","expiresAt","nextPollAt")
 SELECT @id,@device,@user,@client,@resource,@scope,now,now+interval '10 minutes',now+interval '5 seconds' FROM stamp RETURNING "expiresAt"`,
		pgx.NamedArgs{"id": grant.ID, "device": deviceDigest, "user": userDigest, "client": ClientID, "resource": s.resource, "scope": Scope}).Scan(&grant.ExpiresAt)
	if err != nil {
		return Grant{}, s.unavailable(ctx, "start")
	}
	if err = tx.Commit(ctx); err != nil {
		return Grant{}, s.unavailable(ctx, "start")
	}
	return grant, nil
}

type storedGrant struct {
	id         uuid.UUID
	status     string
	expiresAt  time.Time
	nextPollAt time.Time
	now        time.Time
	interval   int
	approval   []byte
	userID     uuid.UUID
	sessionID  uuid.UUID
}

func (s *Service) load(ctx context.Context, tx pgx.Tx, kind string, digest []byte, serialize bool) (*storedGrant, error) {
	column := `"deviceDigest"`
	if kind == "user-code" {
		column = `"userCodeDigest"`
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM vaultix_device_authorizations WHERE `+column+`=@digest AND "clientId"=@client AND resource=@resource AND scope=@scope AND "schemaVersion"=1`, pgx.NamedArgs{"digest": digest, "client": ClientID, "resource": s.resource, "scope": Scope}).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidGrant
	}
	if err != nil {
		return nil, s.unavailable(ctx, "read")
	}
	if serialize {
		// Serialize this grant before policy work, but do not lock its row before
		// the authority owner locks user/session. Account deletion can cascade to
		// grants; retaining user-before-grant row order avoids that deadlock.
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('vaultix.device.v1:'||@id,0))`, pgx.NamedArgs{"id": id.String()}); err != nil {
			return nil, s.unavailable(ctx, "lock")
		}
	}
	grant := &storedGrant{id: id}
	err = tx.QueryRow(ctx, `SELECT status,"expiresAt","nextPollAt","intervalSeconds",approval,
 COALESCE("userId",'00000000-0000-0000-0000-000000000000'),COALESCE("sessionId",'00000000-0000-0000-0000-000000000000'),clock_timestamp()
 FROM vaultix_device_authorizations WHERE id=@id AND "schemaVersion"=1 AND `+column+`=@digest AND "clientId"=@client AND resource=@resource AND scope=@scope`, pgx.NamedArgs{"id": id, "digest": digest, "client": ClientID, "resource": s.resource, "scope": Scope}).Scan(&grant.status, &grant.expiresAt, &grant.nextPollAt, &grant.interval, &grant.approval, &grant.userID, &grant.sessionID, &grant.now)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidGrant
	}
	if err != nil {
		return nil, s.unavailable(ctx, "read")
	}
	if !grant.expiresAt.After(grant.now) {
		return nil, ErrExpired
	}
	return grant, nil
}

func (s *Service) Inspect(ctx context.Context, userCode string) (Info, error) {
	canonical, valid := canonicalUserCode(userCode)
	if !valid {
		return Info{}, ErrInvalidRequest
	}
	tx, err := s.db.Primary().BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return Info{}, s.unavailable(ctx, "inspect")
	}
	defer tx.Rollback(ctx)
	grant, err := s.load(ctx, tx, "user-code", s.digest("user-code", canonical), false)
	if err != nil {
		return Info{}, err
	}
	if grant.status != "pending" {
		return Info{}, ErrInvalidGrant
	}
	return Info{ID: grant.id, ClientName: "Vaultix CLI", Resource: s.resource, Scope: Scope, ExpiresAt: grant.expiresAt}, nil
}

func matchesActor(approval *Approval, actor *auth.Identity) bool {
	return actor != nil && actor.AuthMode == auth.AuthModeJWT && actor.Actor == auth.ActorTypeUser &&
		actor.ActorID != uuid.Nil && actor.TokenVersionID != uuid.Nil && actor.OrgID != uuid.Nil && actor.RootOrgID != uuid.Nil &&
		actor.SessionAccessVersion != nil && *actor.SessionAccessVersion >= 0 &&
		approval.UserID == actor.ActorID && approval.SessionID == actor.TokenVersionID &&
		approval.OrgID == actor.OrgID && approval.RootOrgID == actor.RootOrgID &&
		approval.AccessVersion == *actor.SessionAccessVersion && approval.AuthMethod != "" &&
		approval.AuthMethod == string(actor.AuthMethod) && approval.MFAVerified == actor.IsMfaVerified &&
		approval.MFAMethod == actor.MfaMethod && approval.PolicyDigest != [32]byte{}
}

// Approve is called only after an explicit browser confirmation. The mandatory
// authority collaborator rechecks current account and tenant policy in this tx.
func (s *Service) Approve(ctx context.Context, userCode string, actor *auth.Identity) error {
	canonical, valid := canonicalUserCode(userCode)
	if !valid || actor == nil || auth.AssumedPrivilegeFromContext(ctx) != nil {
		return ErrInvalidRequest
	}
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return s.unavailable(ctx, "approve")
	}
	defer tx.Rollback(ctx)
	grant, err := s.load(ctx, tx, "user-code", s.digest("user-code", canonical), true)
	if err != nil {
		return err
	}
	if grant.status != "pending" {
		return ErrInvalidGrant
	}
	approval, err := s.authority.Approve(ctx, tx, actor)
	if err != nil {
		if errors.Is(err, ErrUnavailable) {
			return ErrUnavailable
		}
		return ErrDenied
	}
	if !matchesActor(&approval, actor) {
		return ErrDenied
	}
	encoded, err := json.Marshal(approval)
	if err != nil || len(encoded) > 2048 {
		return ErrDenied
	}
	result, err := tx.Exec(ctx, `UPDATE vaultix_device_authorizations SET status='approved',"userId"=@user,"sessionId"=@session,approval=@approval
 WHERE id=@id AND status='pending' AND "expiresAt">clock_timestamp()`, pgx.NamedArgs{"id": grant.id, "user": approval.UserID, "session": approval.SessionID, "approval": encoded})
	if err != nil {
		return s.unavailable(ctx, "approve")
	}
	if result.RowsAffected() != 1 {
		return ErrInvalidGrant
	}
	if err = tx.Commit(ctx); err != nil {
		return s.unavailable(ctx, "approve")
	}
	return nil
}

// Cancel requires the confidential device code. Browser denial uses the public
// user code only while pending; neither operation can revoke an issued session.
func (s *Service) Cancel(ctx context.Context, request Request, deviceCode string) error {
	if !s.validRequest(request) || !validDeviceCode(deviceCode) {
		return ErrInvalidRequest
	}
	return s.deny(ctx, "device-code", s.digest("device-code", deviceCode))
}

func (s *Service) Deny(ctx context.Context, userCode string) error {
	canonical, valid := canonicalUserCode(userCode)
	if !valid {
		return ErrInvalidRequest
	}
	return s.deny(ctx, "user-code", s.digest("user-code", canonical))
}

func (s *Service) deny(ctx context.Context, kind string, digest []byte) error {
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return s.unavailable(ctx, "deny")
	}
	defer tx.Rollback(ctx)
	grant, err := s.load(ctx, tx, kind, digest, true)
	if err != nil {
		return err
	}
	if grant.status != "pending" && (kind != "device-code" || grant.status != "approved") {
		return ErrInvalidGrant
	}
	result, err := tx.Exec(ctx, `UPDATE vaultix_device_authorizations SET status='denied',approval=NULL,"userId"=NULL,"sessionId"=NULL WHERE id=@id AND status=@status AND "expiresAt">clock_timestamp()`, pgx.NamedArgs{"id": grant.id, "status": grant.status})
	if err != nil {
		return s.unavailable(ctx, "deny")
	}
	if result.RowsAffected() != 1 {
		return ErrInvalidGrant
	}
	if err = tx.Commit(ctx); err != nil {
		return s.unavailable(ctx, "deny")
	}
	return nil
}

func (s *Service) Poll(ctx context.Context, request Request, deviceCode string) (Session, error) {
	if !s.validRequest(request) || !validDeviceCode(deviceCode) {
		return Session{}, ErrInvalidRequest
	}
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return Session{}, s.unavailable(ctx, "poll")
	}
	defer tx.Rollback(ctx)
	grant, err := s.load(ctx, tx, "device-code", s.digest("device-code", deviceCode), true)
	if err != nil {
		return Session{}, err
	}
	if grant.status == "denied" {
		return Session{}, ErrDenied
	}
	if grant.status == "consumed" {
		return Session{}, ErrInvalidGrant
	}
	if grant.nextPollAt.After(grant.now) {
		_, err = tx.Exec(ctx, `UPDATE vaultix_device_authorizations SET "intervalSeconds"=LEAST("intervalSeconds"+5,60),
 "nextPollAt"=clock_timestamp()+make_interval(secs=>LEAST("intervalSeconds"+5,60)) WHERE id=@id`, pgx.NamedArgs{"id": grant.id})
		return Session{}, s.commitProtocol(ctx, tx, err, ErrSlowDown)
	}
	if grant.status == "pending" {
		_, err = tx.Exec(ctx, `UPDATE vaultix_device_authorizations SET "nextPollAt"=clock_timestamp()+make_interval(secs=>"intervalSeconds") WHERE id=@id`, pgx.NamedArgs{"id": grant.id})
		return Session{}, s.commitProtocol(ctx, tx, err, ErrPending)
	}
	var approval Approval
	if grant.status != "approved" || json.Unmarshal(grant.approval, &approval) != nil ||
		approval.UserID != grant.userID || approval.SessionID != grant.sessionID || approval.PolicyDigest == [32]byte{} {
		return Session{}, ErrDenied
	}
	// Collaborators cannot change the recorded approval while checking it or
	// issuing a session. A private copy preserves the authoritative provenance.
	checked := approval
	if err = s.authority.Revalidate(ctx, tx, &checked); err != nil {
		if errors.Is(err, ErrUnavailable) {
			return Session{}, ErrUnavailable
		}
		_, err = tx.Exec(ctx, `UPDATE vaultix_device_authorizations SET status='denied',approval=NULL,"userId"=NULL,"sessionId"=NULL WHERE id=@id`, pgx.NamedArgs{"id": grant.id})
		return Session{}, s.commitProtocol(ctx, tx, err, ErrDenied)
	}
	if checked != approval {
		return Session{}, ErrDenied
	}
	session, err := s.issuer.IssueDeviceSession(ctx, tx, &checked, ClientID, s.resource, Scope)
	if err != nil || session.AccessToken == "" || session.RefreshToken == "" || session.ExpiresIn <= 0 {
		return Session{}, s.unavailable(ctx, "issue")
	}
	if checked != approval {
		return Session{}, ErrDenied
	}
	result, err := tx.Exec(ctx, `UPDATE vaultix_device_authorizations SET status='consumed'
 WHERE id=@id AND status='approved' AND approval=@approval AND "expiresAt">clock_timestamp()`, pgx.NamedArgs{"id": grant.id, "approval": grant.approval})
	if err != nil {
		return Session{}, s.unavailable(ctx, "consume")
	}
	if result.RowsAffected() != 1 {
		return Session{}, ErrInvalidGrant
	}
	if err = tx.Commit(ctx); err != nil {
		return Session{}, s.unavailable(ctx, "consume")
	}
	return session, nil
}

func (s *Service) commitProtocol(ctx context.Context, tx pgx.Tx, updateError, protocolError error) error {
	if updateError != nil {
		return s.unavailable(ctx, "transition")
	}
	if err := tx.Commit(ctx); err != nil {
		return s.unavailable(ctx, "transition")
	}
	return protocolError
}

func cleanup(ctx context.Context, tx pgx.Tx) (int64, error) {
	result, err := tx.Exec(ctx, `WITH expired AS (SELECT id FROM vaultix_device_authorizations
 WHERE "expiresAt"<=clock_timestamp() ORDER BY "expiresAt",id LIMIT @limit FOR UPDATE SKIP LOCKED)
 DELETE FROM vaultix_device_authorizations grants USING expired WHERE grants.id=expired.id`, pgx.NamedArgs{"limit": cleanupBatch})
	return result.RowsAffected(), err
}

// Cleanup removes at most one fixed batch. Runtime scheduling is a separate
// wiring obligation; Start also performs one batch before bounded admission.
func (s *Service) Cleanup(ctx context.Context) (int64, error) {
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return 0, s.unavailable(ctx, "cleanup")
	}
	defer tx.Rollback(ctx)
	count, err := cleanup(ctx, tx)
	if err != nil {
		return 0, s.unavailable(ctx, "cleanup")
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, s.unavailable(ctx, "cleanup")
	}
	return count, nil
}
