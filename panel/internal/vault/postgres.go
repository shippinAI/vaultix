package vault

import (
	"context"
	"crypto/cipher"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres is the live Vaultix store. Values are AES-GCM sealed in vaultix_secrets.
type Postgres struct {
	pool *pgxpool.Pool
	aead cipher.AEAD
}

func OpenPostgres(ctx context.Context, dsn, keyHex string) (*Postgres, error) {
	aead, err := aeadFromHex(keyHex)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("vault: postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("vault: postgres ping: %w", err)
	}
	if _, err := pool.Exec(ctx, Schema); err != nil {
		pool.Close()
		return nil, fmt.Errorf("vault: apply schema: %w", err)
	}
	return &Postgres{pool: pool, aead: aead}, nil
}

func (p *Postgres) Close() { p.pool.Close() }

func (p *Postgres) Healthy(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

func (p *Postgres) CountBoxes(ctx context.Context) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx, `SELECT count(*) FROM vaultix_boxes`).Scan(&n)
	return n, err
}

func (p *Postgres) CreateBox(ctx context.Context, tenant, name string) (Box, error) {
	name = trimName(name)
	if name == "" || tenant == "" {
		return Box{}, fmt.Errorf("vault: tenant and name required")
	}
	slug := slugify(name)
	for i := 0; i < 8; i++ {
		id := newID()
		try := slug
		if i > 0 {
			try = slug + "-" + newID()[:8]
		}
		b, err := p.insertBox(ctx, id, tenant, name, try)
		if err == nil {
			return b, nil
		}
		if !isUnique(err) {
			return Box{}, err
		}
	}
	return Box{}, fmt.Errorf("vault: could not allocate box slug")
}

func (p *Postgres) EnsureBox(ctx context.Context, id, tenant, name string) (Box, error) {
	if id == "" {
		return p.CreateBox(ctx, tenant, name)
	}
	b, err := p.GetBox(ctx, id)
	if err == nil {
		return b, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return Box{}, err
	}
	name = trimName(name)
	if name == "" {
		name = id
	}
	if tenant == "" {
		return Box{}, fmt.Errorf("vault: tenant required")
	}
	return p.insertBox(ctx, id, tenant, name, slugify(name)+"-"+id[:8])
}

func (p *Postgres) insertBox(ctx context.Context, id, tenant, name, slug string) (Box, error) {
	var b Box
	err := p.pool.QueryRow(ctx, `
		INSERT INTO vaultix_boxes (id, tenant_id, name, slug)
		VALUES ($1, $2, $3, $4)
		RETURNING id, tenant_id, name, slug, created_at, updated_at`,
		id, tenant, name, slug,
	).Scan(&b.ID, &b.TenantID, &b.Name, &b.Slug, &b.CreatedAt, &b.UpdatedAt)
	return b, err
}

func (p *Postgres) GetBox(ctx context.Context, id string) (Box, error) {
	var b Box
	err := p.pool.QueryRow(ctx, `
		SELECT id, tenant_id, name, slug, created_at, updated_at
		FROM vaultix_boxes WHERE id = $1`, id,
	).Scan(&b.ID, &b.TenantID, &b.Name, &b.Slug, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Box{}, ErrNotFound
	}
	return b, err
}

func (p *Postgres) PutSecret(ctx context.Context, boxID, env, name, value, actor string) (SecretMeta, error) {
	if err := requireCoords(boxID, env, name); err != nil {
		return SecretMeta{}, err
	}
	if value == "" {
		return SecretMeta{}, fmt.Errorf("vault: value required")
	}
	if _, err := p.GetBox(ctx, boxID); err != nil {
		return SecretMeta{}, err
	}
	nonce, ct, err := seal(p.aead, value)
	if err != nil {
		return SecretMeta{}, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return SecretMeta{}, err
	}
	defer tx.Rollback(ctx)

	var id string
	var ver int
	var updated time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, version FROM vaultix_secrets WHERE box_id = $1 AND env = $2 AND name = $3`,
		boxID, env, name,
	).Scan(&id, &ver)
	now := time.Now().UTC()
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		id = newID()
		ver = 1
		_, err = tx.Exec(ctx, `
			INSERT INTO vaultix_secrets (id, box_id, env, name, version, ciphertext, nonce, created_by, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			id, boxID, env, name, ver, ct, nonce, actor, now)
	case err != nil:
		return SecretMeta{}, err
	default:
		ver++
		_, err = tx.Exec(ctx, `
			UPDATE vaultix_secrets
			SET version = $1, ciphertext = $2, nonce = $3, created_by = $4, updated_at = $5
			WHERE id = $6`,
			ver, ct, nonce, actor, now, id)
	}
	if err != nil {
		return SecretMeta{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO vaultix_secret_versions (id, secret_id, version, ciphertext, nonce, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		newID(), id, ver, ct, nonce, actor); err != nil {
		return SecretMeta{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SecretMeta{}, err
	}
	updated = now
	return SecretMeta{BoxID: boxID, Env: env, Name: name, Version: ver, UpdatedAt: updated, UpdatedBy: actor}, nil
}

func (p *Postgres) GetSecretMeta(ctx context.Context, boxID, env, name string) (SecretMeta, error) {
	var m SecretMeta
	err := p.pool.QueryRow(ctx, `
		SELECT box_id, env, name, version, updated_at, created_by
		FROM vaultix_secrets WHERE box_id = $1 AND env = $2 AND name = $3`,
		boxID, env, name,
	).Scan(&m.BoxID, &m.Env, &m.Name, &m.Version, &m.UpdatedAt, &m.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return SecretMeta{}, ErrNotFound
	}
	return m, err
}

func (p *Postgres) ListSecretMeta(ctx context.Context, boxID, env string) ([]SecretMeta, error) {
	if _, err := p.GetBox(ctx, boxID); err != nil {
		return nil, err
	}
	q := `SELECT box_id, env, name, version, updated_at, created_by FROM vaultix_secrets WHERE box_id = $1`
	args := []any{boxID}
	if env != "" {
		q += ` AND env = $2`
		args = append(args, env)
	}
	q += ` ORDER BY name`
	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SecretMeta
	for rows.Next() {
		var m SecretMeta
		if err := rows.Scan(&m.BoxID, &m.Env, &m.Name, &m.Version, &m.UpdatedAt, &m.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (p *Postgres) Reveal(ctx context.Context, boxID, env, name string) (string, error) {
	var nonce, ct []byte
	err := p.pool.QueryRow(ctx, `
		SELECT nonce, ciphertext FROM vaultix_secrets
		WHERE box_id = $1 AND env = $2 AND name = $3`,
		boxID, env, name,
	).Scan(&nonce, &ct)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return open(p.aead, nonce, ct)
}

func (p *Postgres) MintInject(ctx context.Context, boxID, env, name, actor string, ttl time.Duration) (string, time.Time, error) {
	if err := requireCoords(boxID, env, name); err != nil {
		return "", time.Time{}, err
	}
	if ttl <= 0 {
		ttl = 90 * time.Second
	}
	if _, err := p.GetSecretMeta(ctx, boxID, env, name); err != nil {
		return "", time.Time{}, err
	}
	handle := newHandle()
	exp := time.Now().UTC().Add(ttl)
	_, err := p.pool.Exec(ctx, `
		INSERT INTO vaultix_injects (id, handle_hash, box_id, env, name, created_by, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		newID(), hashHandle(handle), boxID, env, name, actor, exp)
	return handle, exp, err
}

func (p *Postgres) ConsumeInject(ctx context.Context, handle string) (Redeem, error) {
	if handle == "" {
		return Redeem{}, ErrNotFound
	}
	h := hashHandle(handle)
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Redeem{}, err
	}
	defer tx.Rollback(ctx)

	var boxID, env, name string
	var exp time.Time
	var consumed *time.Time
	err = tx.QueryRow(ctx, `
		SELECT box_id, env, name, expires_at, consumed_at
		FROM vaultix_injects WHERE handle_hash = $1 FOR UPDATE`, h,
	).Scan(&boxID, &env, &name, &exp, &consumed)
	if errors.Is(err, pgx.ErrNoRows) {
		return Redeem{}, ErrNotFound
	}
	if err != nil {
		return Redeem{}, err
	}
	if consumed != nil && !consumed.IsZero() {
		return Redeem{}, ErrConsumed
	}
	if time.Now().After(exp) {
		return Redeem{}, ErrExpired
	}
	tag, err := tx.Exec(ctx, `
		UPDATE vaultix_injects SET consumed_at = now()
		WHERE handle_hash = $1 AND consumed_at IS NULL`, h)
	if err != nil {
		return Redeem{}, err
	}
	if tag.RowsAffected() != 1 {
		return Redeem{}, ErrConsumed
	}
	var nonce, ct []byte
	err = tx.QueryRow(ctx, `
		SELECT nonce, ciphertext FROM vaultix_secrets
		WHERE box_id = $1 AND env = $2 AND name = $3`,
		boxID, env, name,
	).Scan(&nonce, &ct)
	if errors.Is(err, pgx.ErrNoRows) {
		return Redeem{}, ErrNotFound
	}
	if err != nil {
		return Redeem{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Redeem{}, err
	}
	val, err := open(p.aead, nonce, ct)
	if err != nil {
		return Redeem{}, err
	}
	return Redeem{BoxID: boxID, Env: env, Name: name, Value: val}, nil
}

func isUnique(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "unique") || strings.Contains(s, "duplicate")
}
