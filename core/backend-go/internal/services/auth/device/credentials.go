package device

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	AccessTokenType = "vaultix-device-access-v1"
	accessMediaType = "vaultix-device-at+jwt"
	refreshPrefix   = "vxd1."
	refreshBodySize = 16 + 16 + 8 + 32 // User, session, generation, random nonce.
	refreshSize     = refreshBodySize + sha256.Size
)

var ErrInvalidCredential = errors.New("device credentials are invalid; sign in again")

// Credentials owns encoding and cryptographic profile verification only. It
// cannot establish current account/session/tenant authority or revoke a session.
// Public activation requires the lifecycle owner and real API consumers.
type Credentials struct {
	resource       string
	accessKey      []byte
	refreshKey     []byte
	accessLifetime time.Duration
}

type CredentialsDeps struct {
	Secret         []byte
	Resource       string
	AccessLifetime time.Duration
}

func NewCredentials(_ context.Context, logger *slog.Logger, deps *CredentialsDeps) (*Credentials, error) {
	if logger == nil || deps == nil || len(deps.Secret) < 32 || len(deps.Secret) > 4096 ||
		!validResource(deps.Resource) || deps.AccessLifetime < time.Second ||
		deps.AccessLifetime%time.Second != 0 || deps.AccessLifetime > 24*time.Hour {
		return nil, ErrUnavailable
	}
	// Separate keys prevent these credentials from being interpreted as existing
	// browser, delegated OAuth, workload or device-code credentials. The instance
	// binding is cryptographic as well as an explicit signed claim.
	derive := func(kind string) []byte {
		mac := hmac.New(sha256.New, deps.Secret)
		_, _ = mac.Write([]byte("vaultix.device-credential.v1\x00" + kind + "\x00" + deps.Resource + "\x00" + ClientID + "\x00" + Scope))
		return mac.Sum(nil)
	}
	return &Credentials{resource: deps.Resource, accessKey: derive("access"), refreshKey: derive("refresh"), accessLifetime: deps.AccessLifetime}, nil
}

// AccessIdentity is signed provenance, not an authorization decision. Policy
// snapshots and secret values never enter access tokens. Consumers must still
// check current canonical session versions, account and organization policy.
type AccessIdentity struct {
	UserID        uuid.UUID `json:"userId"`
	SessionID     uuid.UUID `json:"tokenVersionId"`
	RootOrgID     uuid.UUID `json:"organizationId"`
	OrgID         uuid.UUID `json:"subOrganizationId"`
	AccessVersion int64     `json:"accessVersion"`
	AuthMethod    string    `json:"authMethod"`
	MFAVerified   bool      `json:"isMfaVerified"`
	MFAMethod     string    `json:"mfaMethod,omitempty"`
	SSOBypass     bool      `json:"ssoBypass,omitempty"`
}

func (p *AccessIdentity) valid() bool {
	if p == nil || p.UserID == uuid.Nil || p.SessionID == uuid.Nil || p.RootOrgID == uuid.Nil || p.OrgID == uuid.Nil ||
		p.AccessVersion < 1 || p.AccessVersion > math.MaxInt32 || !knownAuthMethod(p.AuthMethod) {
		return false
	}
	if !p.MFAVerified {
		return p.MFAMethod == ""
	}
	return p.MFAMethod == "email" || p.MFAMethod == "totp" || p.MFAMethod == "webauthn"
}

type deviceAccessClaims struct {
	jwt.RegisteredClaims
	AccessIdentity
	AuthTokenType string          `json:"authTokenType"`
	ClientID      string          `json:"client_id"`
	Scope         string          `json:"scope"`
	OAuthClientID json.RawMessage `json:"oauthClientId,omitempty"`
	MCP           json.RawMessage `json:"mcp,omitempty"`
}

func (c *Credentials) valid() bool {
	return c != nil && c.resource != "" && len(c.accessKey) == sha256.Size && len(c.refreshKey) == sha256.Size && c.accessLifetime >= time.Second
}

// IssueAccess accepts authoritative database times from the session owner. It
// refuses an expiry beyond the configured short access lifetime. The session
// owner must also cap this against the organization's and session's expiration.
func (c *Credentials) IssueAccess(identity *AccessIdentity, issuedAt, expiresAt time.Time) (string, error) {
	issuedAt, expiresAt = issuedAt.UTC().Truncate(time.Second), expiresAt.UTC().Truncate(time.Second)
	if !c.valid() || !identity.valid() || issuedAt.Unix() <= 0 || !expiresAt.After(issuedAt) || expiresAt.Sub(issuedAt) > c.accessLifetime {
		return "", ErrInvalidCredential
	}
	claims := deviceAccessClaims{AccessIdentity: *identity, AuthTokenType: AccessTokenType, ClientID: ClientID, Scope: Scope,
		RegisteredClaims: jwt.RegisteredClaims{Issuer: c.resource, Subject: identity.UserID.String(), Audience: jwt.ClaimStrings{c.resource}, IssuedAt: jwt.NewNumericDate(issuedAt), ExpiresAt: jwt.NewNumericDate(expiresAt)}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["typ"] = accessMediaType
	encoded, err := token.SignedString(c.accessKey)
	if err != nil {
		return "", ErrInvalidCredential
	}
	return encoded, nil
}

// VerifyAccess authenticates this profile, not its current database authority.
// The caller supplies its trusted clock, never a timestamp from an HTTP body.
func (c *Credentials) VerifyAccess(encoded string, now time.Time) (AccessIdentity, error) {
	if !c.valid() || encoded == "" || len(encoded) > 4096 || now.Unix() <= 0 {
		return AccessIdentity{}, ErrInvalidCredential
	}
	claims := &deviceAccessClaims{}
	token, err := jwt.ParseWithClaims(encoded, claims, func(token *jwt.Token) (any, error) {
		_, critical := token.Header["crit"]
		if token.Header["typ"] != accessMediaType || critical {
			return nil, ErrInvalidCredential
		}
		return c.accessKey, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(c.resource), jwt.WithAudience(c.resource),
		jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || token == nil || !token.Valid || !claims.valid() || claims.AuthTokenType != AccessTokenType ||
		len(claims.OAuthClientID) != 0 || len(claims.MCP) != 0 ||
		claims.ClientID != ClientID || claims.Scope != Scope || claims.Subject != claims.UserID.String() ||
		len(claims.Audience) != 1 || claims.IssuedAt == nil || claims.ExpiresAt == nil || claims.NotBefore != nil ||
		claims.IssuedAt.Unix() <= 0 || !claims.ExpiresAt.After(claims.IssuedAt.Time) ||
		claims.ExpiresAt.Sub(claims.IssuedAt.Time) > c.accessLifetime {
		return AccessIdentity{}, ErrInvalidCredential
	}
	return claims.AccessIdentity, nil
}

// RefreshIdentity is an authenticated locator. It conveys no permission and
// contains no expiration: both expiration and rotation state belong to the
// primary database. A consumer must verify it before acting on replay claims.
type RefreshIdentity struct {
	UserID     uuid.UUID
	SessionID  uuid.UUID
	Generation int64
}

func (p RefreshIdentity) valid() bool {
	return p.UserID != uuid.Nil && p.SessionID != uuid.Nil && p.Generation >= 1 && p.Generation <= math.MaxInt32
}

func (c *Credentials) IssueRefresh(identity RefreshIdentity) (string, error) {
	if !c.valid() || !identity.valid() {
		return "", ErrInvalidCredential
	}
	var raw [refreshSize]byte
	copy(raw[:16], identity.UserID[:])
	copy(raw[16:32], identity.SessionID[:])
	binary.BigEndian.PutUint64(raw[32:40], uint64(identity.Generation))
	_, _ = rand.Read(raw[40:refreshBodySize])
	mac := hmac.New(sha256.New, c.refreshKey)
	_, _ = mac.Write(raw[:refreshBodySize])
	copy(raw[refreshBodySize:], mac.Sum(nil))
	return refreshPrefix + base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func (c *Credentials) VerifyRefresh(encoded string) (RefreshIdentity, error) {
	if !c.valid() || len(encoded) != len(refreshPrefix)+base64.RawURLEncoding.EncodedLen(refreshSize) || encoded[:len(refreshPrefix)] != refreshPrefix {
		return RefreshIdentity{}, ErrInvalidCredential
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(encoded[len(refreshPrefix):])
	if err != nil || len(raw) != refreshSize {
		return RefreshIdentity{}, ErrInvalidCredential
	}
	mac := hmac.New(sha256.New, c.refreshKey)
	_, _ = mac.Write(raw[:refreshBodySize])
	if !hmac.Equal(raw[refreshBodySize:], mac.Sum(nil)) {
		return RefreshIdentity{}, ErrInvalidCredential
	}
	identity := RefreshIdentity{UserID: uuid.UUID(raw[:16]), SessionID: uuid.UUID(raw[16:32]), Generation: int64(binary.BigEndian.Uint64(raw[32:40]))}
	if !identity.valid() {
		return RefreshIdentity{}, ErrInvalidCredential
	}
	return identity, nil
}
