//go:build integration

// This disposable-image fixture issues through the real grant/session owners.
// It is not a production login endpoint. Inputs and credentials use stdin/stdout
// only; the image harness keeps both in memory and never records raw output.
package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vaultix/api/internal/config"
	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/server/api/shared"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/internal/services/auth/device"
)

type primaryDB struct{ pool *pgxpool.Pool }

func (d *primaryDB) Primary() *pgxpool.Pool { return d.pool }
func (*primaryDB) Replica() *pgxpool.Pool   { panic("device proof must use primary authority") }
func (*primaryDB) ReplicaCount() int        { return 0 }
func (d *primaryDB) Close()                 { d.pool.Close() }

func checked(err error, phase string) {
	if err != nil {
		if _, writeErr := os.Stderr.WriteString("Device proof failed: " + phase + "\n"); writeErr != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var input struct{ BrowserToken string }
	checked(json.NewDecoder(io.LimitReader(os.Stdin, 16384)).Decode(&input), "input")
	logger := slog.New(slog.DiscardHandler)
	pool, err := pgxpool.New(ctx, os.Getenv("DB_CONNECTION_URI"))
	checked(err, "database")
	defer pool.Close()
	db := &primaryDB{pool: pool}
	policy, err := config.ParseIdentityTokenPolicy("2h", "2026-01-01T00:00:00Z")
	checked(err, "policy")
	a, err := apiauth.NewApiAuthenticator(ctx, logger, &apiauth.AuthenticatorDeps{
		DB: db, AuthSecret: os.Getenv("AUTH_SECRET"), KeyStore: keystore.NewMemoryKeyStore(),
		AssumePrivilege: nil, ErrorHandler: shared.NewErrorHandler(logger), IdentityPolicy: policy, DeviceAccess: nil,
	})
	checked(err, "authenticator")
	actor, err := a.ValidateJWT(ctx, input.BrowserToken)
	checked(err, "browser authority")
	ctx = auth.WithIdentity(ctx, actor)
	ctx = auth.WithHTTPInfo(ctx, &auth.HTTPInfo{IPAddress: "127.0.0.1", UserAgent: "Vaultix disposable device proof", UserAgentType: "cli"})
	credentials, err := device.NewCredentials(ctx, logger, &device.CredentialsDeps{
		Secret: []byte(os.Getenv("AUTH_SECRET")), Resource: os.Getenv("SITE_URL"), AccessLifetime: 15 * time.Minute,
	})
	checked(err, "credential profile")
	authority, err := device.NewNativeAuthority(ctx, logger, &device.NativeAuthorityDeps{})
	checked(err, "authority")
	sessions, err := device.NewSessions(ctx, logger, &device.SessionsDeps{DB: db, Credentials: credentials, Authority: authority, RefreshLifetime: 24 * time.Hour})
	checked(err, "sessions")
	grants, err := device.NewService(ctx, logger, &device.Deps{
		DB: db, HashKey: []byte(os.Getenv("AUTH_SECRET")), Resource: os.Getenv("SITE_URL"), MaxOutstanding: 10, Authority: authority, SessionIssuer: sessions,
	})
	checked(err, "grants")
	request := device.Request{ClientID: device.ClientID, Resource: os.Getenv("SITE_URL"), Scope: device.Scope}
	grant, err := grants.Start(ctx, request)
	checked(err, "start")
	checked(grants.Approve(ctx, grant.UserCode, actor), "approve")
	select {
	case <-ctx.Done():
		checked(ctx.Err(), "poll wait")
	case <-time.After(grant.Interval + time.Second):
	}
	session, err := grants.Poll(ctx, request, grant.DeviceCode)
	checked(err, "poll")
	identity, err := sessions.ValidateAccess(ctx, session.AccessToken)
	checked(err, "session verification")
	checked(json.NewEncoder(os.Stdout).Encode(map[string]string{
		"access": session.AccessToken, "refresh": session.RefreshToken, "sessionId": identity.SessionID.String(), "userId": identity.UserID.String(),
	}), "output")
}
