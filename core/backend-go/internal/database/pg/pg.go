package pg

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"math/rand/v2"
	"net/url"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/infisical/api/internal/config"
	"github.com/infisical/api/internal/database/pg/prefix"
)

// Querier is implemented by both *pgxpool.Pool and pgx.Tx.
// Use this interface for functions that can work with or without a transaction.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Handle is the subset of *pgxpool.Pool that services use. An empty
// DB_TABLE_PREFIX returns the pool itself. A prefix returns a wrapper that
// rewrites physical names before Postgres sees the statement.
type Handle interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
	Ping(ctx context.Context) error
}

type DB interface {
	Primary() Handle
	Replica() Handle
	ReplicaCount() int
	Close()
}

// pgDatabase wraps a primary pgxpool and zero or more read-replica pools.
type pgDatabase struct {
	primary      Handle
	primaryPool  *pgxpool.Pool
	replicas     []Handle
	replicaPools []*pgxpool.Pool
}

// NewPostgresDB creates a connection pool for the primary database and optional read replicas.
// primaryRootCert is used as fallback for replicas that don't specify their own cert.
func NewPostgresDB(ctx context.Context, primaryURI, primaryRootCert string, readReplicas []config.DBReadReplica) (DB, error) {
	prefixer, err := prefix.Load(os.Getenv("DB_TABLE_PREFIX"))
	if err != nil {
		return nil, err
	}
	var rewrite func(string) string
	if prefixer.Prefix() != "" {
		rewrite = prefixer.Rewrite
	}

	primaryMin, primaryMax, err := poolLimits("DB_POOL_MIN", "DB_POOL_MAX", 0, 10)
	if err != nil {
		return nil, err
	}
	replicaMin, replicaMax, err := poolLimits("DB_REPLICA_POOL_MIN", "DB_REPLICA_POOL_MAX", primaryMin, primaryMax)
	if err != nil {
		return nil, err
	}

	primaryPool, err := openPool(ctx, primaryURI, primaryRootCert, primaryMin, primaryMax)
	if err != nil {
		return nil, fmt.Errorf("primary db: %w", err)
	}

	replicaPools := make([]*pgxpool.Pool, 0, len(readReplicas))
	replicaHandles := make([]Handle, 0, len(readReplicas))
	for i, r := range readReplicas {
		rootCert := r.DBRootCert
		if rootCert == "" {
			rootCert = primaryRootCert
		}

		pool, err := openPool(ctx, r.DBConnectionURI, rootCert, replicaMin, replicaMax)
		if err != nil {
			primaryPool.Close()
			for _, p := range replicaPools {
				p.Close()
			}
			return nil, fmt.Errorf("read replica %d: %w", i, err)
		}
		replicaPools = append(replicaPools, pool)
		replicaHandles = append(replicaHandles, wrapPool(pool, rewrite))
	}

	return &pgDatabase{
		primary:      wrapPool(primaryPool, rewrite),
		primaryPool:  primaryPool,
		replicas:     replicaHandles,
		replicaPools: replicaPools,
	}, nil
}

// Primary returns the primary database handle for writes.
func (db *pgDatabase) Primary() Handle {
	return db.primary
}

// Replica returns a random read-replica handle, or the primary if no replicas are configured.
func (db *pgDatabase) Replica() Handle {
	if len(db.replicas) == 0 {
		return db.primary
	}
	return db.replicas[rand.IntN(len(db.replicas))]
}

// ReplicaCount returns the number of read replicas configured.
func (db *pgDatabase) ReplicaCount() int {
	return len(db.replicas)
}

// Close closes all connection pools (primary + replicas).
func (db *pgDatabase) Close() {
	db.primaryPool.Close()
	for _, r := range db.replicaPools {
		r.Close()
	}
}

// openPool creates a pgxpool.Pool from a connection URI and optional base64-encoded root CA cert.
// It mirrors the Node.js parseSslConfig logic:
//   - If dbRootCert is set, TLS is enabled with that CA.
//   - If the URI contains sslmode=verify-ca or verify-full, rejectUnauthorized is true (InsecureSkipVerify = false).
//   - Otherwise when a cert is provided but sslmode is something else (e.g. require), the CA is trusted
//     but server identity is not strictly verified (InsecureSkipVerify = true).
//   - The sslmode param is stripped from the URI before passing to pgx (pgx handles TLS via its own config).
func openPool(ctx context.Context, connURI, dbRootCert string, minConns, maxConns int32) (*pgxpool.Pool, error) {
	modifiedURI, tlsCfg, err := parseSslConfig(connURI, dbRootCert)
	if err != nil {
		return nil, err
	}

	poolCfg, err := pgxpool.ParseConfig(modifiedURI)
	if err != nil {
		return nil, fmt.Errorf("parsing connection URI: %w", err)
	}

	poolCfg.MinConns = minConns
	poolCfg.MaxConns = maxConns
	if poolCfg.ConnConfig.RuntimeParams == nil {
		poolCfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	if poolCfg.ConnConfig.RuntimeParams["application_name"] == "" {
		poolCfg.ConnConfig.RuntimeParams["application_name"] = "vaultix-core"
	}

	if tlsCfg != nil {
		poolCfg.ConnConfig.TLSConfig = tlsCfg
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("creating pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	return pool, nil
}

// parseSslConfig mirrors the Node.js parseSslConfig function and additionally
// normalizes the node-postgres-specific "no-verify" sslmode, which pgx/libpq
// reject ("sslmode is invalid"). It returns a possibly modified URI and an
// optional TLS config.
//
// sslmode is stripped from the URI whenever we configure TLS ourselves, because
// pgx applies TLS through ConnConfig.TLSConfig rather than the URI.
//   - dbRootCert set: trust that CA; verify the server cert only for verify-ca
//     and verify-full, otherwise skip verification (InsecureSkipVerify).
//   - dbRootCert empty + sslmode=no-verify: encrypt but skip verification,
//     matching node-postgres semantics.
//   - dbRootCert empty + any other sslmode: leave the URI untouched and let pgx
//     configure TLS natively.
func parseSslConfig(connURI, dbRootCert string) (string, *tls.Config, error) {
	sslMode := sslModeOf(connURI)

	if dbRootCert == "" {
		// pgx does not understand the node-postgres "no-verify" value. Translate
		// it to an encrypted, unverified connection so pgx can parse the URI.
		if strings.EqualFold(sslMode, "no-verify") {
			return stripSslMode(connURI), &tls.Config{InsecureSkipVerify: true}, nil
		}
		return connURI, nil, nil
	}

	caPEM, err := base64.StdEncoding.DecodeString(dbRootCert)
	if err != nil {
		return "", nil, fmt.Errorf("decoding DB_ROOT_CERT base64: %w", err)
	}

	certPool := x509.NewCertPool()
	if !certPool.AppendCertsFromPEM(caPEM) {
		return "", nil, fmt.Errorf("failed to parse DB root certificate PEM")
	}

	tlsCfg := &tls.Config{
		RootCAs:            certPool,
		InsecureSkipVerify: true,
	}

	modifiedURI := connURI
	if sslMode != "" && !strings.EqualFold(sslMode, "disable") {
		modifiedURI = stripSslMode(connURI)

		if strings.EqualFold(sslMode, "verify-ca") || strings.EqualFold(sslMode, "verify-full") {
			tlsCfg.InsecureSkipVerify = false
		}
	}

	return modifiedURI, tlsCfg, nil
}

// sslModeOf returns the sslmode query parameter of a connection URI, or "" if
// the URI cannot be parsed or has no sslmode.
func sslModeOf(connURI string) string {
	parsed, err := url.Parse(connURI)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("sslmode")
}

// stripSslMode removes the sslmode query parameter from a connection URI. pgx
// applies TLS via ConnConfig.TLSConfig rather than the URI, so once we build our
// own tls.Config the param is redundant (and "no-verify" is invalid in pgx).
func stripSslMode(connURI string) string {
	parsed, err := url.Parse(connURI)
	if err != nil {
		return connURI
	}
	q := parsed.Query()
	q.Del("sslmode")
	parsed.RawQuery = q.Encode()
	return parsed.String()
}
