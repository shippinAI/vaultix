// Package device owns first-party device authorization state. It is not an
// identity provider or an alternate account store. Public activation requires
// the native policy/session consumers and browser/CLI acceptance in plan 0074.
package device

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/services/auth"
)

const (
	ClientID = "vaultix-cli"
	Scope    = "vaultix:user"
	Lifetime = 10 * time.Minute
	Interval = 5 * time.Second
)

var (
	ErrInvalidRequest = errors.New("invalid device authorization request")
	ErrInvalidGrant   = errors.New("device authorization is unavailable; start a new sign-in")
	ErrPending        = errors.New("authorization_pending")
	ErrSlowDown       = errors.New("slow_down")
	ErrDenied         = errors.New("access_denied")
	ErrExpired        = errors.New("expired_token")
	ErrUnavailable    = errors.New("device sign-in is temporarily unavailable; try again later")
)

// Approval is credential-free provenance. The policy owner must validate current
// account/session/membership, method, MFA and tenant policy, using this transaction.
// A browser's initial unscoped password-login response is never sufficient.
type Approval struct {
	UserID        uuid.UUID `json:"userId"`
	SessionID     uuid.UUID `json:"sessionId"`
	OrgID         uuid.UUID `json:"orgId"`
	RootOrgID     uuid.UUID `json:"rootOrgId"`
	AccessVersion int64     `json:"accessVersion"`
	AuthMethod    string    `json:"authMethod"`
	MFAVerified   bool      `json:"mfaVerified"`
	MFAMethod     string    `json:"mfaMethod"`
	PolicyDigest  [32]byte  `json:"policyDigest"`
	SSOBypass     bool      `json:"ssoBypass,omitempty"`
}

// Authority must perform bounded database-only work on the supplied primary
// transaction. Neither method may trust caller-provided policy or open another
// connection. Revalidate checks the original session and current tenant policy.
type Authority interface {
	Approve(context.Context, pgx.Tx, *auth.Identity) (Approval, error)
	Revalidate(context.Context, pgx.Tx, *Approval) error
}

// SessionIssuer creates a dedicated first-party session in the same transaction
// that consumes the grant. It must not reuse a browser session or issue delegated
// OAuth credentials as full user credentials. Refresh/revocation have their own
// domain owner; this interface is not a claim that those consumers exist yet.
type SessionIssuer interface {
	IssueDeviceSession(context.Context, pgx.Tx, *Approval, string, string, string) (Session, error)
}

// Session is returned only by successful redemption, never inspection or GET.
type Session struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    time.Duration
}

func (Session) String() string     { return "Vaultix device session [credentials redacted]" }
func (s Session) GoString() string { return s.String() }

type Request struct {
	ClientID string
	Resource string
	Scope    string
}

type Grant struct {
	ID         uuid.UUID
	DeviceCode string
	UserCode   string
	ExpiresAt  time.Time
	Interval   time.Duration
}

func (Grant) String() string   { return "Vaultix device grant [codes redacted]" }
func (Grant) GoString() string { return "Vaultix device grant [codes redacted]" }

// Info contains only what a person needs to review the requested connection.
// No credential, approver identity, session ID or factor information is exposed.
type Info struct {
	ID         uuid.UUID
	ClientName string
	Resource   string
	Scope      string
	ExpiresAt  time.Time
}
