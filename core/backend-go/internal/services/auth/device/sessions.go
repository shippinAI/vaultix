package device

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/netip"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/services/auth"
)

type SessionsDeps struct {
	DB              pg.DB
	Credentials     *Credentials
	Authority       *NativeAuthority
	RefreshLifetime time.Duration
}

type Sessions struct {
	db          pg.DB
	credentials *Credentials
	authority   *NativeAuthority
	lifetime    time.Duration
	logger      *slog.Logger
}

var _ SessionIssuer = (*Sessions)(nil)

func NewSessions(_ context.Context, logger *slog.Logger, deps *SessionsDeps) (*Sessions, error) {
	if logger == nil || deps == nil || deps.DB == nil || !deps.Credentials.valid() || deps.Authority == nil ||
		deps.RefreshLifetime < time.Second || deps.RefreshLifetime%time.Second != 0 || deps.RefreshLifetime > 365*24*time.Hour {
		return nil, ErrUnavailable
	}
	return &Sessions{db: deps.DB, credentials: deps.Credentials, authority: deps.Authority, lifetime: deps.RefreshLifetime, logger: logger}, nil
}

func (s *Sessions) requestValid(request Request) bool {
	return request.ClientID == ClientID && request.Scope == Scope && request.Resource == s.credentials.resource
}

func (s *Sessions) failure(ctx context.Context, operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidCredential
	}
	s.logger.ErrorContext(ctx, "Vaultix device session unavailable", slog.String("operation", operation))
	return ErrUnavailable
}

// The organization's existing setting is an integer followed by m/h/d/w. Cap
// large values before multiplying; malformed policy must never extend a session.
func cappedLifetime(value string, maximum time.Duration) (time.Duration, error) {
	if value == "" {
		return maximum, nil
	}
	if len(value) < 2 || len(value) > 64 {
		return 0, ErrDenied
	}
	var unit time.Duration
	switch value[len(value)-1] {
	case 'm':
		unit = time.Minute
	case 'h':
		unit = time.Hour
	case 'd':
		unit = 24 * time.Hour
	case 'w':
		unit = 7 * 24 * time.Hour
	default:
		return 0, ErrDenied
	}
	for _, c := range value[:len(value)-1] {
		if c < '0' || c > '9' {
			return 0, ErrDenied
		}
	}
	n, err := strconv.ParseUint(value[:len(value)-1], 10, 64)
	if err != nil || n == 0 {
		return 0, ErrDenied
	}
	if n > uint64(maximum/unit) {
		return maximum, nil
	}
	return min(time.Duration(n)*unit, maximum), nil
}

func (s *Sessions) IssueDeviceSession(ctx context.Context, tx pgx.Tx, approval *Approval, client, resource, scope string) (Session, error) {
	if tx == nil || approval == nil || !s.requestValid(Request{ClientID: client, Resource: resource, Scope: scope}) {
		return Session{}, ErrInvalidRequest
	}
	if err := s.authority.Revalidate(ctx, tx, approval); err != nil {
		return Session{}, err
	}
	info := auth.HTTPInfoFromContext(ctx)
	if info == nil || len(info.UserAgent) > 255 {
		return Session{}, ErrInvalidRequest
	}
	if _, err := netip.ParseAddr(info.IPAddress); err != nil {
		return Session{}, ErrInvalidRequest
	}
	var now time.Time
	var policies []string
	err := tx.QueryRow(ctx, `SELECT clock_timestamp(),array_agg(COALESCE("userTokenExpiration",'')) FROM organizations WHERE id IN (@org,@root)`, pgx.NamedArgs{"org": approval.OrgID, "root": approval.RootOrgID}).Scan(&now, &policies)
	if err != nil {
		return Session{}, s.failure(ctx, "lifetime", err)
	}
	lifetime := s.lifetime
	for _, policy := range policies {
		lifetime, err = cappedLifetime(policy, lifetime)
		if err != nil {
			return Session{}, err
		}
	}
	issued := *approval
	issued.SessionID, issued.AccessVersion = uuid.New(), 1
	now = now.UTC().Truncate(time.Second)
	expires := now.Add(lifetime)
	session, digest, err := s.tokens(&issued, 1, now, expires)
	if err != nil {
		return Session{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO auth_token_sessions(id,"userId",ip,"userAgent","accessVersion","refreshVersion","lastUsed","createdAt","updatedAt","sessionType")
 VALUES(@id,@user,@ip,@agent,1,1,@now,@now,@now,'device-v1')`, pgx.NamedArgs{"id": issued.SessionID, "user": issued.UserID, "ip": info.IPAddress, "agent": info.UserAgent, "now": now})
	if err != nil {
		return Session{}, s.failure(ctx, "issue", err)
	}
	encoded, err := json.Marshal(issued)
	if err != nil {
		return Session{}, ErrUnavailable
	}
	_, err = tx.Exec(ctx, `INSERT INTO vaultix_device_sessions("sessionId","clientId",resource,scope,approval,"refreshDigest","createdAt","expiresAt")
 VALUES(@id,@client,@resource,@scope,@approval,@digest,@now,@expires)`, pgx.NamedArgs{"id": issued.SessionID, "client": client, "resource": resource, "scope": scope, "approval": encoded, "digest": digest[:], "now": now, "expires": expires})
	if err != nil {
		return Session{}, s.failure(ctx, "metadata", err)
	}
	if err := s.record(ctx, tx, &issued, "issued"); err != nil {
		return Session{}, err
	}
	return session, nil
}

func (s *Sessions) tokens(approval *Approval, generation int64, now, expires time.Time) (Session, [32]byte, error) {
	identity := accessIdentity(approval)
	accessExpiry := minTime(now.Add(s.credentials.accessLifetime), expires).Truncate(time.Second)
	access, err := s.credentials.IssueAccess(&identity, now, accessExpiry)
	if err != nil {
		return Session{}, [32]byte{}, err
	}
	refresh, err := s.credentials.IssueRefresh(RefreshIdentity{UserID: approval.UserID, SessionID: approval.SessionID, Generation: generation})
	if err != nil {
		return Session{}, [32]byte{}, err
	}
	return Session{AccessToken: access, RefreshToken: refresh, ExpiresIn: accessExpiry.Sub(now.Truncate(time.Second))}, sha256.Sum256([]byte(refresh)), nil
}

func accessIdentity(approval *Approval) AccessIdentity {
	return AccessIdentity{UserID: approval.UserID, SessionID: approval.SessionID, RootOrgID: approval.RootOrgID, OrgID: approval.OrgID, AccessVersion: approval.AccessVersion, AuthMethod: approval.AuthMethod, MFAVerified: approval.MFAVerified, MFAMethod: approval.MFAMethod, SSOBypass: approval.SSOBypass}
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

type storedSession struct {
	approval      Approval
	generation    int64
	accessVersion int64
	digest        []byte
	expires       time.Time
	now           time.Time
}

func (s *Sessions) load(ctx context.Context, tx pgx.Tx, user, id uuid.UUID) (*storedSession, error) {
	// Account deletion cascades to sessions. Every lifecycle operation uses the
	// same user-before-session row lock order, including refresh-reuse revocation.
	var locked uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE id=@user FOR UPDATE`, pgx.NamedArgs{"user": user}).Scan(&locked); err != nil {
		return nil, s.failure(ctx, "account", err)
	}
	row := &storedSession{}
	var encoded []byte
	err := tx.QueryRow(ctx, `SELECT sessions."refreshVersion",sessions."accessVersion",metadata.approval,metadata."refreshDigest",metadata."expiresAt",clock_timestamp()
 FROM auth_token_sessions sessions JOIN vaultix_device_sessions metadata ON metadata."sessionId"=sessions.id
 WHERE sessions.id=@id AND sessions."userId"=@user AND sessions."sessionType"='device-v1'
 AND metadata."schemaVersion"=1 AND metadata."clientId"=@client AND metadata.resource=@resource AND metadata.scope=@scope
 FOR UPDATE OF sessions,metadata`, pgx.NamedArgs{"id": id, "user": user, "client": ClientID, "resource": s.credentials.resource, "scope": Scope}).Scan(&row.generation, &row.accessVersion, &encoded, &row.digest, &row.expires, &row.now)
	if err != nil {
		return nil, s.failure(ctx, "session", err)
	}
	if json.Unmarshal(encoded, &row.approval) != nil || row.approval.UserID != user || row.approval.SessionID != id || len(row.digest) != 32 {
		return nil, ErrInvalidCredential
	}
	return row, nil
}

// Security-event persistence joins the session transaction. Delivery must use
// the existing audit/notification owners; these rows are not delivery receipts.
// No FK to session/user: deletion must not erase an undelivered security event.
func (s *Sessions) record(ctx context.Context, tx pgx.Tx, approval *Approval, action string) error {
	provenance := struct {
		AuthMethod  string    `json:"authMethod"`
		MFAVerified bool      `json:"mfaVerified"`
		MFAMethod   string    `json:"mfaMethod"`
		SSOBypass   bool      `json:"ssoBypass"`
		RootOrgID   uuid.UUID `json:"rootOrgId"`
		ClientID    string    `json:"clientId"`
	}{approval.AuthMethod, approval.MFAVerified, approval.MFAMethod, approval.SSOBypass, approval.RootOrgID, ClientID}
	encoded, err := json.Marshal(provenance)
	if err != nil {
		return ErrUnavailable
	}
	_, err = tx.Exec(ctx, `INSERT INTO vaultix_device_session_events(id,"sessionId","userId","orgId",action,provenance)
 VALUES(@id,@session,@user,@org,@action,@provenance)`, pgx.NamedArgs{"id": uuid.New(), "session": approval.SessionID, "user": approval.UserID, "org": approval.OrgID, "action": action, "provenance": encoded})
	if err != nil {
		return s.failure(ctx, "security-event", err)
	}
	return nil
}

func (s *Sessions) revoke(ctx context.Context, tx pgx.Tx, row *storedSession, action string) error {
	if err := s.record(ctx, tx, &row.approval, action); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM auth_token_sessions WHERE id=@id AND "userId"=@user AND "sessionType"='device-v1'`, pgx.NamedArgs{"id": row.approval.SessionID, "user": row.approval.UserID})
	if err != nil {
		return s.failure(ctx, "revoke", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return s.failure(ctx, "commit", err)
	}
	return nil
}

func (s *Sessions) Renew(ctx context.Context, request Request, token string) (Session, error) {
	if !s.requestValid(request) {
		return Session{}, ErrInvalidRequest
	}
	identity, err := s.credentials.VerifyRefresh(token)
	if err != nil {
		return Session{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return Session{}, s.failure(ctx, "begin", err)
	}
	defer tx.Rollback(ctx)
	row, err := s.load(ctx, tx, identity.UserID, identity.SessionID)
	if err != nil {
		return Session{}, err
	}
	if identity.Generation < row.generation {
		if err := s.revoke(ctx, tx, row, "reuse"); err != nil {
			return Session{}, err
		}
		return Session{}, ErrInvalidCredential
	}
	digest := sha256.Sum256([]byte(token))
	if identity.Generation != row.generation || !hmac.Equal(digest[:], row.digest) {
		return Session{}, ErrInvalidCredential
	}
	if !row.expires.After(row.now) || row.accessVersion != row.approval.AccessVersion || row.generation == math.MaxInt32 {
		return Session{}, ErrInvalidCredential
	}
	if err = s.authority.Revalidate(ctx, tx, &row.approval); err != nil {
		if errors.Is(err, ErrUnavailable) {
			return Session{}, err
		}
		if err := s.revoke(ctx, tx, row, "policy-denied"); err != nil {
			return Session{}, err
		}
		return Session{}, ErrDenied
	}
	result, newDigest, err := s.tokens(&row.approval, row.generation+1, row.now, row.expires)
	if err != nil {
		return Session{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE auth_token_sessions SET "refreshVersion"="refreshVersion"+1,"lastUsed"=@now,"updatedAt"=@now WHERE id=@id`, pgx.NamedArgs{"id": identity.SessionID, "now": row.now})
	if err != nil {
		return Session{}, s.failure(ctx, "rotate", err)
	}
	_, err = tx.Exec(ctx, `UPDATE vaultix_device_sessions SET "refreshDigest"=@digest WHERE "sessionId"=@id`, pgx.NamedArgs{"id": identity.SessionID, "digest": newDigest[:]})
	if err != nil {
		return Session{}, s.failure(ctx, "rotate", err)
	}
	if err := s.record(ctx, tx, &row.approval, "rotated"); err != nil {
		return Session{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Session{}, s.failure(ctx, "commit", err)
	}
	return result, nil
}

func (s *Sessions) Revoke(ctx context.Context, request Request, token string) error {
	if !s.requestValid(request) {
		return ErrInvalidRequest
	}
	identity, err := s.credentials.VerifyRefresh(token)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return s.failure(ctx, "begin", err)
	}
	defer tx.Rollback(ctx)
	row, err := s.load(ctx, tx, identity.UserID, identity.SessionID)
	if errors.Is(err, ErrInvalidCredential) {
		return nil
	}
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(token))
	if identity.Generation > row.generation || (identity.Generation == row.generation && !hmac.Equal(digest[:], row.digest)) {
		return ErrInvalidCredential
	}
	return s.revoke(ctx, tx, row, "revoked")
}

func (s *Sessions) ValidateAccess(ctx context.Context, token string) (AccessIdentity, error) {
	identity, err := s.credentials.VerifyAccess(token, time.Now())
	if err != nil {
		return AccessIdentity{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return AccessIdentity{}, s.failure(ctx, "begin", err)
	}
	defer tx.Rollback(ctx)
	row, err := s.load(ctx, tx, identity.UserID, identity.SessionID)
	if err != nil {
		return AccessIdentity{}, err
	}
	// Recheck token time using the same primary database clock as session expiry.
	if _, err = s.credentials.VerifyAccess(token, row.now); err != nil {
		return AccessIdentity{}, err
	}
	if !row.expires.After(row.now) || row.accessVersion != identity.AccessVersion || accessIdentity(&row.approval) != identity {
		return AccessIdentity{}, ErrInvalidCredential
	}
	if err := s.authority.Revalidate(ctx, tx, &row.approval); err != nil {
		return AccessIdentity{}, err
	}
	return identity, nil
}
