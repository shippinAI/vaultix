package apiauth

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/libs/errutil"
)

// identityRevocationContext uses the same resolved scope as membership validation.
// ClientSecretID comes from the signed payload, including on the legacy path.
type identityRevocationContext struct {
	TokenID        string
	IdentityID     uuid.UUID
	IssuedAtMs     int64
	ClientSecretID string
	AuthMethod     string
	OrgID          string
}

type revocationRow struct {
	ID        string
	RevokedAt sql.Null[time.Time]
	CreatedAt time.Time
	Scope     sql.Null[string]
}

func (a *ApiAuthenticator) assertTokenIsNotRevoked(ctx context.Context, token *identityRevocationContext) error {
	revocations, err := a.findActiveRevocationsForToken(ctx, token)
	if err != nil {
		return errutil.DatabaseErr("Failed to check token revocation").WithErrf("assertTokenIsNotRevoked(tokenId=%s, identityId=%s): %w", token.TokenID, token.IdentityID, err)
	}
	if message := revocationDenyMessage(revocations, token); message != "" {
		return errutil.Unauthorized("%s", message).WithErrf("assertTokenIsNotRevoked(tokenId=%s, identityId=%s): revoked", token.TokenID, token.IdentityID)
	}
	return nil
}

// revocationDenyMessage evaluates active, identity-bound markers. A present scope
// (even empty) is never an unconditional token marker. Scoped and identity-wide
// revocations retain the issuer's strict millisecond boundary; exact-token
// revocation is unconditional only when the marker has no scope.
func revocationDenyMessage(markers []revocationRow, token *identityRevocationContext) string {
	for _, marker := range markers {
		revokedAt := marker.CreatedAt
		if marker.RevokedAt.Valid {
			revokedAt = marker.RevokedAt.V
		}
		if !marker.Scope.Valid {
			if marker.ID == token.TokenID {
				return "Failed to authorize: token has been revoked"
			}
			if marker.ID == token.IdentityID.String() && token.IssuedAtMs < revokedAt.UnixMilli() {
				return "Failed to authorize: identity tokens have been revoked"
			}
			continue
		}
		if token.IssuedAtMs >= revokedAt.UnixMilli() {
			continue
		}
		switch scope := marker.Scope.V; {
		case token.ClientSecretID != "" && scope == token.ClientSecretID:
			return "Failed to authorize: client secret has been revoked"
		case token.AuthMethod != "" && scope == token.AuthMethod:
			return "Failed to authorize: auth method has been revoked"
		case token.OrgID != "" && scope == token.OrgID:
			return "Failed to authorize: Identity is not a member of the organization"
		}
	}
	return ""
}

func (a *ApiAuthenticator) findActiveRevocationsForToken(ctx context.Context, token *identityRevocationContext) ([]revocationRow, error) {
	query := `
		SELECT id, "revokedAt", "createdAt", scope
		FROM identity_access_token_revocations
		WHERE "expiresAt" > NOW()
		  AND "identityId" = @identityID
		  AND id IN (@tokenID, @identityIDStr)
	`
	args := pgx.NamedArgs{
		"identityID": token.IdentityID, "tokenID": token.TokenID,
		"identityIDStr": token.IdentityID.String(),
	}
	scopes := make([]string, 0, 3)
	for _, scope := range []string{token.ClientSecretID, token.AuthMethod, token.OrgID} {
		if scope != "" {
			scopes = append(scopes, scope)
		}
	}
	if len(scopes) > 0 {
		// Separate equality arms preserve the PK and partial (identityId, scope)
		// index paths. A marker may match both arms; evaluation is idempotent.
		query += `
			UNION ALL
			SELECT id, "revokedAt", "createdAt", scope
			FROM identity_access_token_revocations
			WHERE "expiresAt" > NOW()
			  AND "identityId" = @identityID
			  AND scope IS NOT NULL AND scope = ANY(@scopes::text[])
		`
		args["scopes"] = scopes
	}

	// Revocation is authoritative security state. A lagging replica must never
	// turn a completed revocation into an allow decision; primary errors fail closed.
	rows, err := a.db.Primary().Query(ctx, query, args)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var markers []revocationRow
	for rows.Next() {
		var marker revocationRow
		if err := rows.Scan(&marker.ID, &marker.RevokedAt, &marker.CreatedAt, &marker.Scope); err != nil {
			return nil, err
		}
		markers = append(markers, marker)
	}
	return markers, rows.Err()
}
