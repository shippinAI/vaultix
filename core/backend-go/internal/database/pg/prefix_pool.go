package pg

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func wrapPool(pool *pgxpool.Pool, rewrite func(string) string) Handle {
	if rewrite == nil {
		return pool
	}
	return &prefixedPool{Pool: pool, rewrite: rewrite}
}

type prefixedPool struct {
	*pgxpool.Pool
	rewrite func(string) string
}

func (p *prefixedPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return p.Pool.Query(ctx, p.rewrite(sql), args...)
}

func (p *prefixedPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return p.Pool.QueryRow(ctx, p.rewrite(sql), args...)
}

func (p *prefixedPool) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return p.Pool.Exec(ctx, p.rewrite(sql), arguments...)
}

func (p *prefixedPool) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &prefixedTx{Tx: tx, rewrite: p.rewrite}, nil
}

type prefixedTx struct {
	pgx.Tx
	rewrite func(string) string
}

func (t *prefixedTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return t.Tx.Query(ctx, t.rewrite(sql), args...)
}

func (t *prefixedTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.Tx.QueryRow(ctx, t.rewrite(sql), args...)
}

func (t *prefixedTx) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return t.Tx.Exec(ctx, t.rewrite(sql), arguments...)
}

func (t *prefixedTx) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := t.Tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &prefixedTx{Tx: tx, rewrite: t.rewrite}, nil
}

func poolLimits(minName, maxName string, defMin, defMax int32) (int32, int32, error) {
	min, err := envInt32(minName, defMin)
	if err != nil {
		return 0, 0, err
	}
	max, err := envInt32(maxName, defMax)
	if err != nil {
		return 0, 0, err
	}
	if max < 1 {
		return 0, 0, fmt.Errorf("%s must be at least 1", maxName)
	}
	if min > max {
		return 0, 0, fmt.Errorf("%s (%d) must be less than or equal to %s (%d)", minName, min, maxName, max)
	}
	return min, max, nil
}

func envInt32(name string, fallback int32) (int32, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return int32(n), nil
}
