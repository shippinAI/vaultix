package vault

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
)

var (
	ErrNotFound     = errors.New("vault: not found")
	ErrNoEngine     = errors.New("vault: engine not configured")
	ErrExpired      = errors.New("vault: inject handle expired")
	ErrConsumed     = errors.New("vault: inject handle already used")
	ErrHiddenSource = errors.New("vault: source returned hidden secret values; refusing import")
)

// Box is one app's vault ("one box per app"). Metadata only.
type Box struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenantId"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SecretMeta is what GET may return. Never a value.
type SecretMeta struct {
	BoxID     string    `json:"boxId"`
	Env       string    `json:"environment"`
	Name      string    `json:"name"`
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy string    `json:"updatedBy"`
}

// Redeem is the one-shot inject payload. The value leaves the engine only here.
type Redeem struct {
	BoxID string `json:"boxId"`
	Env   string `json:"environment"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Engine is the Vaultix secrets store. Values are sealed at rest.
type Engine interface {
	CreateBox(ctx context.Context, tenant, name string) (Box, error)
	EnsureBox(ctx context.Context, id, tenant, name string) (Box, error)
	GetBox(ctx context.Context, id string) (Box, error)
	PutSecret(ctx context.Context, boxID, env, name, value, actor string) (SecretMeta, error)
	GetSecretMeta(ctx context.Context, boxID, env, name string) (SecretMeta, error)
	ListSecretMeta(ctx context.Context, boxID, env string) ([]SecretMeta, error)
	Reveal(ctx context.Context, boxID, env, name string) (string, error)
	MintInject(ctx context.Context, boxID, env, name, actor string, ttl time.Duration) (handle string, exp time.Time, err error)
	ConsumeInject(ctx context.Context, handle string) (Redeem, error)
	CountBoxes(ctx context.Context) (int, error)
	Healthy(ctx context.Context) error
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func newHandle() string {
	var b [24]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func hashHandle(handle string) string {
	sum := sha256.Sum256([]byte(handle))
	return hex.EncodeToString(sum[:])
}

func slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	hyphen := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			hyphen = false
			continue
		}
		if !hyphen && b.Len() > 0 {
			b.WriteByte('-')
			hyphen = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "box"
	}
	if len(out) > 48 {
		out = out[:48]
	}
	return out
}

func requireCoords(boxID, env, name string) error {
	if strings.TrimSpace(boxID) == "" || strings.TrimSpace(env) == "" || strings.TrimSpace(name) == "" {
		return errors.New("vault: box, environment, and name required")
	}
	return nil
}
