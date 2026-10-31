//go:build integration

package auth_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/device"
)

// These collaborators exercise the grant owner's transaction contract, NOT
// production tenant policy or usable session issuance. Public activation still
// requires native policy, real token/refresh ownership, browser and CLI proofs.
type deviceCollaborators struct {
	approveError    error
	revalidateError error
	issueError      error
	mutate          func(*device.Approval)
	expireOnIssue   bool
	mutateOnCheck   bool
	mutateOnIssue   bool
}

func (f *deviceCollaborators) Approve(ctx context.Context, tx pgx.Tx, actor *auth.Identity) (device.Approval, error) {
	if f.approveError != nil {
		return device.Approval{}, f.approveError
	}
	if actor.SessionAccessVersion == nil {
		return device.Approval{}, device.ErrDenied
	}
	approval := device.Approval{UserID: actor.ActorID, SessionID: actor.TokenVersionID, OrgID: actor.OrgID, RootOrgID: actor.RootOrgID, AccessVersion: *actor.SessionAccessVersion, AuthMethod: string(actor.AuthMethod), MFAVerified: actor.IsMfaVerified, MFAMethod: actor.MfaMethod, PolicyDigest: [32]byte{1}}
	if f.mutate != nil {
		f.mutate(&approval)
	}
	err := f.Revalidate(ctx, tx, &approval)
	return approval, err
}

func (f *deviceCollaborators) Revalidate(ctx context.Context, tx pgx.Tx, approval *device.Approval) error {
	if f.revalidateError != nil {
		return f.revalidateError
	}
	var user uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE id=@id AND "isAccepted" AND NOT "isLocked" FOR UPDATE`, pgx.NamedArgs{"id": approval.UserID}).Scan(&user); err != nil {
		return device.ErrDenied
	}
	var version int64
	if err := tx.QueryRow(ctx, `SELECT "accessVersion" FROM auth_token_sessions WHERE id=@id AND "userId"=@user FOR UPDATE`, pgx.NamedArgs{"id": approval.SessionID, "user": approval.UserID}).Scan(&version); err != nil || version != approval.AccessVersion {
		return device.ErrDenied
	}
	if f.mutateOnCheck {
		approval.OrgID = uuid.New()
	}
	return nil
}

func (f *deviceCollaborators) IssueDeviceSession(ctx context.Context, tx pgx.Tx, approval *device.Approval, client, resource, scope string) (device.Session, error) {
	if client != "vaultix-cli" || resource != "https://device.example.test" || scope != "vaultix:user" {
		return device.Session{}, device.ErrDenied
	}
	_, err := tx.Exec(ctx, `INSERT INTO auth_token_sessions(id,"userId","accessVersion","refreshVersion",ip,"userAgent","lastUsed","createdAt","updatedAt") VALUES(@id,@user,1,1,'127.0.0.1','device-transaction-fixture',NOW(),NOW(),NOW())`, pgx.NamedArgs{"id": uuid.New(), "user": approval.UserID})
	if err != nil {
		return device.Session{}, err
	}
	if f.expireOnIssue {
		_, err = tx.Exec(ctx, `UPDATE vaultix_device_authorizations SET "createdAt"=clock_timestamp()-interval '11 minutes',"expiresAt"=clock_timestamp()-interval '1 minute' WHERE "userId"=@user`, pgx.NamedArgs{"user": approval.UserID})
		if err != nil {
			return device.Session{}, err
		}
	}
	if f.mutateOnIssue {
		approval.OrgID = uuid.New()
	}
	return device.Session{AccessToken: "fixture-access-canary", RefreshToken: "fixture-refresh-canary", ExpiresIn: time.Minute}, f.issueError
}

type deviceFixture struct {
	service *device.Service
	deps    *device.Deps
	policy  *deviceCollaborators
	logs    bytes.Buffer
}

func newDeviceFixture(t *testing.T, db pg.DB) *deviceFixture {
	t.Helper()
	f := &deviceFixture{policy: &deviceCollaborators{}}
	f.deps = &device.Deps{DB: db, HashKey: bytes.Repeat([]byte{7}, 32), Resource: "https://device.example.test", MaxOutstanding: 1000, Authority: f.policy, SessionIssuer: f.policy}
	var err error
	f.service, err = device.NewService(context.Background(), slog.New(slog.NewTextHandler(&f.logs, nil)), f.deps)
	require.NoError(t, err)
	return f
}

func deviceRequest() device.Request {
	return device.Request{ClientID: "vaultix-cli", Resource: "https://device.example.test", Scope: "vaultix:user"}
}

func startDevice(t *testing.T, f *deviceFixture) device.Grant {
	t.Helper()
	grant, err := f.service.Start(context.Background(), deviceRequest())
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(context.Background(), `DELETE FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": grant.ID})
		require.NoError(t, err)
	})
	return grant
}

func devicePollReady(t *testing.T, id uuid.UUID) {
	t.Helper()
	_, err := stack.DB().Primary().Exec(context.Background(), `UPDATE vaultix_device_authorizations SET "nextPollAt"=clock_timestamp()-interval '1 second' WHERE id=@id`, pgx.NamedArgs{"id": id})
	require.NoError(t, err)
}

func deviceState(t *testing.T, id uuid.UUID) string {
	t.Helper()
	var state string
	require.NoError(t, stack.DB().Primary().QueryRow(context.Background(), `SELECT status FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": id}).Scan(&state))
	return state
}

func deviceIssued(t *testing.T, user uuid.UUID) int {
	t.Helper()
	var count int
	require.NoError(t, stack.DB().Primary().QueryRow(context.Background(), `SELECT count(*) FROM auth_token_sessions WHERE "userId"=@user AND "userAgent"='device-transaction-fixture'`, pgx.NamedArgs{"user": user}).Scan(&count))
	return count
}

func TestDeviceAuthorization_LifecycleStorageAndPolling(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	f := newDeviceFixture(t, stack.DB())
	grant := startDevice(t, f)
	require.Equal(t, 5*time.Second, grant.Interval)
	var stored string
	var lifetime time.Duration
	var seconds float64
	require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT row_to_json(grants)::text,extract(epoch FROM "expiresAt"-"createdAt") FROM vaultix_device_authorizations grants WHERE id=@id`, pgx.NamedArgs{"id": grant.ID}).Scan(&stored, &seconds))
	lifetime = time.Duration(seconds) * time.Second
	require.Equal(t, 10*time.Minute, lifetime)
	require.NotContains(t, stored, grant.DeviceCode)
	require.NotContains(t, stored, grant.UserCode)
	info, err := f.service.Inspect(ctx, grant.UserCode)
	require.NoError(t, err)
	require.Equal(t, grant.ID, info.ID)
	require.Equal(t, "Vaultix CLI", info.ClientName)
	_, err = f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
	require.ErrorIs(t, err, device.ErrSlowDown)
	var interval int
	var future bool
	require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT "intervalSeconds","nextPollAt">clock_timestamp()+interval '9 seconds' FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": grant.ID}).Scan(&interval, &future))
	require.Equal(t, 10, interval)
	require.True(t, future)
	devicePollReady(t, grant.ID)
	_, err = f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
	require.ErrorIs(t, err, device.ErrPending)
	require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
	require.ErrorIs(t, f.service.Approve(ctx, grant.UserCode, actor), device.ErrInvalidGrant)
	_, err = f.service.Inspect(ctx, grant.UserCode)
	require.ErrorIs(t, err, device.ErrInvalidGrant)
	devicePollReady(t, grant.ID)
	session, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
	require.NoError(t, err)
	require.Equal(t, "fixture-access-canary", session.AccessToken)
	require.Equal(t, 1, deviceIssued(t, actor.ActorID))
	require.Equal(t, "consumed", deviceState(t, grant.ID))
	_, err = f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
	require.ErrorIs(t, err, device.ErrInvalidGrant)
	require.ErrorIs(t, f.service.Cancel(ctx, deviceRequest(), grant.DeviceCode), device.ErrInvalidGrant)
}

func TestDeviceAuthorization_RequestAndApproverBindings(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	f := newDeviceFixture(t, stack.DB())
	grant := startDevice(t, f)
	for _, bad := range []device.Request{{ClientID: "other", Resource: deviceRequest().Resource, Scope: deviceRequest().Scope}, {ClientID: deviceRequest().ClientID, Resource: "https://other.example.test", Scope: deviceRequest().Scope}, {ClientID: deviceRequest().ClientID, Resource: deviceRequest().Resource, Scope: "secrets:read"}} {
		_, err := f.service.Start(ctx, bad)
		require.ErrorIs(t, err, device.ErrInvalidRequest)
		_, err = f.service.Poll(ctx, bad, grant.DeviceCode)
		require.ErrorIs(t, err, device.ErrInvalidRequest)
		require.ErrorIs(t, f.service.Cancel(ctx, bad, grant.DeviceCode), device.ErrInvalidRequest)
	}
	for _, scenario := range []string{"user", "session", "org", "root", "version", "method", "mfa", "factor", "policy"} {
		t.Run(scenario, func(t *testing.T) {
			f.policy.mutate = func(a *device.Approval) {
				switch scenario {
				case "user":
					a.UserID = uuid.New()
				case "session":
					a.SessionID = uuid.New()
				case "org":
					a.OrgID = uuid.New()
				case "root":
					a.RootOrgID = uuid.New()
				case "version":
					a.AccessVersion++
				case "method":
					a.AuthMethod = "oidc"
				case "mfa":
					a.MFAVerified = !a.MFAVerified
				case "factor":
					a.MFAMethod = "totp"
				case "policy":
					a.PolicyDigest = [32]byte{}
				}
			}
			require.ErrorIs(t, f.service.Approve(ctx, grant.UserCode, actor), device.ErrDenied)
			require.Equal(t, "pending", deviceState(t, grant.ID))
		})
	}
	f.policy.mutate = nil
	// A restarted replica uses the same key and store; a different resource/key
	// cannot inspect or redeem this instance's grant even with the raw code.
	for _, scenario := range []string{"resource", "key"} {
		deps := *f.deps
		if scenario == "resource" {
			deps.Resource = "https://other.example.test"
		} else {
			deps.HashKey = bytes.Repeat([]byte{8}, 32)
		}
		other, err := device.NewService(ctx, slog.New(slog.NewTextHandler(&f.logs, nil)), &deps)
		require.NoError(t, err)
		_, err = other.Inspect(ctx, grant.UserCode)
		require.ErrorIs(t, err, device.ErrInvalidGrant)
		request := deviceRequest()
		request.Resource = deps.Resource
		_, err = other.Poll(ctx, request, grant.DeviceCode)
		require.ErrorIs(t, err, device.ErrInvalidGrant)
	}
	require.Zero(t, deviceIssued(t, actor.ActorID))
}

func TestDeviceAuthorization_DenialCancellationAndExpiry(t *testing.T) {
	for _, scenario := range []string{"browser-deny", "cancel-pending", "cancel-approved", "expired"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			f := newDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			expected := device.ErrDenied
			switch scenario {
			case "browser-deny":
				require.NoError(t, f.service.Deny(ctx, grant.UserCode))
			case "cancel-pending":
				require.NoError(t, f.service.Cancel(ctx, deviceRequest(), grant.DeviceCode))
			case "cancel-approved":
				require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
				require.ErrorIs(t, f.service.Deny(ctx, grant.UserCode), device.ErrInvalidGrant)
				require.NoError(t, f.service.Cancel(ctx, deviceRequest(), grant.DeviceCode))
			case "expired":
				_, err := stack.DB().Primary().Exec(ctx, `UPDATE vaultix_device_authorizations SET "createdAt"=clock_timestamp()-interval '11 minutes',"expiresAt"=clock_timestamp()-interval '1 minute' WHERE id=@id`, pgx.NamedArgs{"id": grant.ID})
				require.NoError(t, err)
				require.ErrorIs(t, f.service.Approve(ctx, grant.UserCode, actor), device.ErrExpired)
				expected = device.ErrExpired
			}
			_, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
			require.ErrorIs(t, err, expected)
			require.Zero(t, deviceIssued(t, actor.ActorID))
		})
	}
}

func TestDeviceAuthorization_AtomicRollbackAndPolicyChanges(t *testing.T) {
	for _, scenario := range []string{"issuer-error", "expires-during-issue", "authority-unavailable", "authority-denied", "session-version", "locked", "mutated-authority", "mutated-issuer"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			f := newDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
			devicePollReady(t, grant.ID)
			expected := device.ErrUnavailable
			state := "approved"
			switch scenario {
			case "mutated-authority":
				f.policy.mutateOnCheck = true
				expected = device.ErrDenied
			case "mutated-issuer":
				f.policy.mutateOnIssue = true
				expected = device.ErrDenied
			case "issuer-error":
				f.policy.issueError = errors.New("fixture-access-canary fixture-refresh-canary " + grant.DeviceCode)
			case "expires-during-issue":
				f.policy.expireOnIssue = true
				expected = device.ErrInvalidGrant
			case "authority-unavailable":
				f.policy.revalidateError = device.ErrUnavailable
			case "authority-denied":
				f.policy.revalidateError = device.ErrDenied
				expected = device.ErrDenied
				state = "denied"
			case "session-version":
				_, err := stack.DB().Primary().Exec(ctx, `UPDATE auth_token_sessions SET "accessVersion"=2 WHERE id=@id`, pgx.NamedArgs{"id": actor.TokenVersionID})
				require.NoError(t, err)
				expected = device.ErrDenied
				state = "denied"
			case "locked":
				_, err := stack.DB().Primary().Exec(ctx, `UPDATE users SET "isLocked"=true WHERE id=@id`, pgx.NamedArgs{"id": actor.ActorID})
				require.NoError(t, err)
				expected = device.ErrDenied
				state = "denied"
			}
			result, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
			require.ErrorIs(t, err, expected)
			require.Empty(t, result.AccessToken)
			require.Empty(t, result.RefreshToken)
			require.Equal(t, state, deviceState(t, grant.ID))
			require.Zero(t, deviceIssued(t, actor.ActorID))
			for _, canary := range []string{grant.DeviceCode, grant.UserCode, "fixture-access-canary", "fixture-refresh-canary"} {
				require.NotContains(t, f.logs.String(), canary)
			}
			if state == "approved" {
				f.policy.mutateOnCheck = false
				f.policy.mutateOnIssue = false
				f.policy.issueError = nil
				f.policy.expireOnIssue = false
				f.policy.revalidateError = nil
				_, err = f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
				require.NoError(t, err)
				require.Equal(t, 1, deviceIssued(t, actor.ActorID))
			}
		})
	}
}

func TestDeviceAuthorization_ConcurrentReplicaRedemption(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	f := newDeviceFixture(t, stack.DB())
	grant := startDevice(t, f)
	require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
	devicePollReady(t, grant.ID)
	replica, err := device.NewService(ctx, slog.New(slog.NewTextHandler(&f.logs, nil)), f.deps)
	require.NoError(t, err)
	var wins, denied atomic.Int32
	var group sync.WaitGroup
	barrier := make(chan struct{})
	for i := range 16 {
		group.Go(func() {
			<-barrier
			svc := f.service
			if i%2 == 0 {
				svc = replica
			}
			_, err := svc.Poll(ctx, deviceRequest(), grant.DeviceCode)
			switch {
			case err == nil:
				wins.Add(1)
			case errors.Is(err, device.ErrInvalidGrant):
				denied.Add(1)
			default:
				t.Error("unexpected concurrent result")
			}
		})
	}
	close(barrier)
	group.Wait()
	require.EqualValues(t, 1, wins.Load())
	require.EqualValues(t, 15, denied.Load())
	require.Equal(t, 1, deviceIssued(t, actor.ActorID))
}

func TestDeviceAuthorization_OneConnectionAndMandatoryOwners(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	cfg, err := pgxpool.ParseConfig(stack.Config().DBConnectionURI)
	require.NoError(t, err)
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	f := newDeviceFixture(t, &bindingDB{pool: pool})
	for _, scenario := range []string{"policy", "issuer", "key", "cap"} {
		deps := *f.deps
		switch scenario {
		case "policy":
			deps.Authority = nil
		case "issuer":
			deps.SessionIssuer = nil
		case "key":
			deps.HashKey = []byte("short")
		case "cap":
			deps.MaxOutstanding = 0
		}
		_, err := device.NewService(ctx, slog.New(slog.NewTextHandler(&f.logs, nil)), &deps)
		require.ErrorIs(t, err, device.ErrUnavailable)
	}
	limited, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	grant := startDevice(t, f)
	require.NoError(t, f.service.Approve(limited, grant.UserCode, actor))
	devicePollReady(t, grant.ID)
	_, err = f.service.Poll(limited, deviceRequest(), grant.DeviceCode)
	require.NoError(t, err)
}

func TestDeviceAuthorization_GlobalAdmissionAndBoundedCleanup(t *testing.T) {
	ctx := context.Background()
	f := newDeviceFixture(t, stack.DB())
	f.deps.MaxOutstanding = 3
	var err error
	f.service, err = device.NewService(ctx, slog.New(slog.NewTextHandler(&f.logs, nil)), f.deps)
	require.NoError(t, err)
	replica, err := device.NewService(ctx, slog.New(slog.NewTextHandler(&f.logs, nil)), f.deps)
	require.NoError(t, err)
	var group sync.WaitGroup
	results := make(chan device.Grant, 12)
	barrier := make(chan struct{})
	for i := range 12 {
		group.Go(func() {
			<-barrier
			svc := f.service
			if i%2 == 0 {
				svc = replica
			}
			grant, err := svc.Start(ctx, deviceRequest())
			if err == nil {
				results <- grant
			} else if !errors.Is(err, device.ErrUnavailable) {
				t.Error("unexpected admission result")
			}
		})
	}
	close(barrier)
	group.Wait()
	close(results)
	var ids []uuid.UUID
	for grant := range results {
		ids = append(ids, grant.ID)
	}
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(context.Background(), `DELETE FROM vaultix_device_authorizations WHERE id=ANY(@ids)`, pgx.NamedArgs{"ids": ids})
		require.NoError(t, err)
	})
	require.Len(t, ids, 3)
	_, err = stack.DB().Primary().Exec(ctx, `UPDATE vaultix_device_authorizations SET "createdAt"=clock_timestamp()-interval '11 minutes',"expiresAt"=clock_timestamp()-interval '1 minute' WHERE id=ANY(@ids)`, pgx.NamedArgs{"ids": ids})
	require.NoError(t, err)
	_ = startDevice(t, f) // Start reclaims expired slots before admission.
	// Independent SQL creates 260 expired rows with distinct digests. Cleanup
	// must be bounded even when the expiry backlog is larger than one batch.
	_, err = stack.DB().Primary().Exec(ctx, `INSERT INTO vaultix_device_authorizations(id,"deviceDigest","userCodeDigest","clientId",resource,scope,"createdAt","expiresAt","nextPollAt")
 SELECT gen_random_uuid(),decode(md5('device-fixture-'||num)||md5('device-fixture-'||num),'hex'),decode(md5('user-fixture-'||num)||md5('user-fixture-'||num),'hex'),'cleanup-fixture','https://cleanup.example.test','fixture',clock_timestamp()-interval '11 minutes',clock_timestamp()-interval '1 minute',clock_timestamp() FROM generate_series(1,260) num`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := stack.DB().Primary().Exec(context.Background(), `DELETE FROM vaultix_device_authorizations WHERE "clientId"='cleanup-fixture'`)
		require.NoError(t, err)
	})
	for _, want := range []int64{128, 128, 4, 0} {
		count, err := f.service.Cleanup(ctx)
		require.NoError(t, err)
		require.Equal(t, want, count)
	}
}
