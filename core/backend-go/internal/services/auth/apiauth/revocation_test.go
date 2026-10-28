package apiauth

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestRevocationDenyMessage_TimeBoundaries(t *testing.T) {
	t.Parallel()
	token := identityRevocationContext{
		TokenID: uuid.NewString(), IdentityID: uuid.New(),
		ClientSecretID: uuid.NewString(), AuthMethod: "universal-auth", OrgID: uuid.NewString(),
	}
	for _, kind := range []struct {
		name, id, scope, message string
	}{
		{"identity", token.IdentityID.String(), "", "identity tokens have been revoked"},
		{"client-secret", uuid.NewString(), token.ClientSecretID, "client secret has been revoked"},
		{"auth-method", uuid.NewString(), token.AuthMethod, "auth method has been revoked"},
		{"organization", uuid.NewString(), token.OrgID, "Identity is not a member of the organization"},
	} {
		t.Run(kind.name, func(t *testing.T) {
			for _, timestamp := range []string{"explicit", "creation-fallback"} {
				t.Run(timestamp, func(t *testing.T) {
					marker := revocationRow{
						ID: kind.id, CreatedAt: time.UnixMilli(2000),
						Scope: sql.Null[string]{V: kind.scope, Valid: kind.scope != ""},
					}
					if timestamp == "explicit" {
						marker.CreatedAt = time.UnixMilli(1000)
						marker.RevokedAt = sql.Null[time.Time]{V: time.UnixMilli(2000), Valid: true}
					}
					for _, boundary := range []struct {
						name     string
						issuedAt int64
						deny     bool
					}{
						{"one-millisecond-before", 1999, true},
						{"equal", 2000, false},
						{"one-millisecond-after", 2001, false},
					} {
						t.Run(boundary.name, func(t *testing.T) {
							current := token
							current.IssuedAtMs = boundary.issuedAt
							want := ""
							if boundary.deny {
								want = "Failed to authorize: " + kind.message
							}
							require.Equal(t, want, revocationDenyMessage([]revocationRow{marker}, &current))
						})
					}
				})
			}
		})
	}
}

func TestRevocationDenyMessage_MarkerIdentity(t *testing.T) {
	t.Parallel()
	token := identityRevocationContext{
		TokenID: uuid.NewString(), IdentityID: uuid.New(), IssuedAtMs: 2000,
		ClientSecretID: uuid.NewString(), AuthMethod: "universal-auth", OrgID: uuid.NewString(),
	}
	for _, tc := range []struct {
		name   string
		marker revocationRow
		want   string
	}{
		{"exact-token-unconditional", revocationRow{ID: token.TokenID}, "Failed to authorize: token has been revoked"},
		{"unrelated-null-scope", revocationRow{ID: uuid.NewString()}, ""},
		{"empty-scope-is-present", revocationRow{ID: token.TokenID, Scope: sql.Null[string]{Valid: true}, CreatedAt: time.UnixMilli(3000)}, ""},
		{"scoped-token-id-before-boundary", revocationRow{ID: token.TokenID, Scope: sql.Null[string]{V: token.ClientSecretID, Valid: true}, CreatedAt: time.UnixMilli(3000)}, "Failed to authorize: client secret has been revoked"},
		{"scoped-token-id-at-boundary", revocationRow{ID: token.TokenID, Scope: sql.Null[string]{V: token.ClientSecretID, Valid: true}, CreatedAt: time.UnixMilli(2000)}, ""},
		{"unrelated-scope-token-id", revocationRow{ID: token.TokenID, Scope: sql.Null[string]{V: uuid.NewString(), Valid: true}, CreatedAt: time.UnixMilli(3000)}, ""},
		{"scoped-identity-id", revocationRow{ID: token.IdentityID.String(), Scope: sql.Null[string]{V: uuid.NewString(), Valid: true}, CreatedAt: time.UnixMilli(3000)}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, revocationDenyMessage([]revocationRow{tc.marker, tc.marker}, &token))
		})
	}
	t.Run("empty-claims-cannot-match-empty-scope", func(t *testing.T) {
		marker := revocationRow{Scope: sql.Null[string]{Valid: true}, CreatedAt: time.UnixMilli(3000)}
		require.Empty(t, revocationDenyMessage([]revocationRow{marker}, &identityRevocationContext{}))
	})
	t.Run("later-marker-still-denies", func(t *testing.T) {
		markers := []revocationRow{{ID: uuid.NewString()}, {ID: token.TokenID}}
		require.Equal(t, "Failed to authorize: token has been revoked", revocationDenyMessage(markers, &token))
	})
}

// A closed primary pool deterministically fails without any network connection.
// Counting the accessors proves routing and that errors do not retry a replica;
// it does not simulate a replication topology.
type revocationRoutingDB struct {
	pool         *pgxpool.Pool
	primaryCalls int
	replicaCalls int
}

func (db *revocationRoutingDB) Primary() *pgxpool.Pool {
	db.primaryCalls++
	return db.pool
}

func (db *revocationRoutingDB) Replica() *pgxpool.Pool {
	db.replicaCalls++
	return db.pool
}

func (db *revocationRoutingDB) ReplicaCount() int { return 1 }
func (db *revocationRoutingDB) Close()            { db.pool.Close() }

func TestAssertTokenIsNotRevoked_PrimaryFailureDenies(t *testing.T) {
	t.Parallel()
	pool, err := pgxpool.New(context.Background(), "postgres://fixture:fixture@127.0.0.1:1/unused?sslmode=disable")
	require.NoError(t, err)
	pool.Close()
	db := &revocationRoutingDB{pool: pool}
	a := &ApiAuthenticator{db: db}
	err = a.assertTokenIsNotRevoked(context.Background(), &identityRevocationContext{
		TokenID: uuid.NewString(), IdentityID: uuid.New(), AuthMethod: "universal-auth",
	})
	require.ErrorContains(t, err, "Failed to check token revocation")
	require.Equal(t, 1, db.primaryCalls)
	require.Zero(t, db.replicaCalls)
}
