package nomen

import (
	"bytes"
	"context"
	"crypto/sha256"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix/api/internal/services/auth"
)

type AuthenticationFactorCrypto interface {
	DecryptAuthenticationFactor(context.Context, []byte) ([]byte, error)
}

type AuthenticationFactorReplay interface {
	SetItemWithExpiryNX(context.Context, string, time.Duration, string) (bool, error)
}

type reauthenticationCredential struct {
	password        string
	factorID        uuid.UUID
	encryptedFactor []byte
	factorDigest    [32]byte
}

func (c *reauthenticationCredential) policyDigest() [32]byte {
	if c.factorID == uuid.Nil {
		return sha256.Sum256([]byte(c.password))
	}
	digest := sha256.New()
	_, _ = digest.Write([]byte("vaultix.password-totp.v1\x00"))
	_, _ = digest.Write([]byte(c.password))
	_, _ = digest.Write(c.factorID[:])
	_, _ = digest.Write(c.factorDigest[:])
	var result [32]byte
	copy(result[:], digest.Sum(nil))
	return result
}

func validTOTPCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, digit := range code {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}

func consumeTOTPStep(ctx context.Context, tx pgx.Tx, factor uuid.UUID, step int64) error {
	var accepted int64
	err := tx.QueryRow(ctx, `INSERT INTO vaultix_totp_replays ("factorId","lastStep") SELECT $1,$2::bigint
 WHERE abs($2::bigint-floor(extract(epoch FROM clock_timestamp())/30)::bigint)<=1
 ON CONFLICT ("factorId") DO UPDATE SET "lastStep"=EXCLUDED."lastStep"
 WHERE vaultix_totp_replays."lastStep"<EXCLUDED."lastStep" RETURNING "lastStep"`, factor, step).Scan(&accepted)
	return err
}

// Provenance is joined to the current proof UUID, never just the user. An older
// binary can supersede a proof without carrying stale factor authority forward.
// Missing provenance cannot downgrade TOTP proof: its policy digest differs from
// the password-only digest, even if policy no longer requires a second factor.
func (s *PasswordReauthentication) proofCredential(ctx context.Context, tx pgx.Tx, actor *auth.Identity, intent IdentityIntent, digest []byte, proofID uuid.UUID) (*reauthenticationCredential, error) {
	var factor uuid.UUID
	var factorDigest []byte
	err := tx.QueryRow(ctx, `SELECT COALESCE(factor."factorId",'00000000-0000-0000-0000-000000000000'::uuid),factor."factorDigest"
 FROM vaultix_identity_reauth_proofs proof LEFT JOIN vaultix_identity_reauth_totp factor ON factor."userId"=proof."userId" AND factor."proofId"=proof.id AND factor."schemaVersion"=1
 WHERE proof."userId"=$1 AND proof."schemaVersion"=1 AND (($2::bytea IS NOT NULL AND proof.digest=$2) OR proof.id=$3)`, actor.ActorID, digest, proofID).Scan(&factor, &factorDigest)
	if err != nil {
		return nil, err
	}
	credential, err := s.credential(ctx, tx, actor, intent, factor != uuid.Nil)
	if err != nil {
		return nil, err
	}
	if factor != credential.factorID || (factor != uuid.Nil && !bytes.Equal(factorDigest, credential.factorDigest[:])) {
		return nil, ErrLinkDenied
	}
	return credential, nil
}
