//go:build integration

package auth_test

import (
	"context"
	"encoding/json"
	"log/slog"
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

func nativeDeviceFixture(t *testing.T, db pg.DB) *deviceFixture {
	t.Helper()
	f := newDeviceFixture(t, db)
	logger := slog.New(slog.NewTextHandler(&f.logs, nil))
	authority, err := device.NewNativeAuthority(context.Background(), logger, &device.NativeAuthorityDeps{})
	require.NoError(t, err)
	f.deps.Authority = authority
	f.service, err = device.NewService(context.Background(), logger, f.deps)
	require.NoError(t, err)
	return f
}

func devicePolicyExec(t *testing.T, query string, args ...any) {
	t.Helper()
	_, err := stack.DB().Primary().Exec(context.Background(), query, args...)
	require.NoError(t, err)
}

func deviceRole(t *testing.T, actor *auth.Identity, role string) {
	t.Helper()
	devicePolicyExec(t, `INSERT INTO membership_roles(id,"membershipId",role)
 SELECT @id,id,@role FROM memberships WHERE "actorUserId"=@user AND "scopeOrgId"=@org AND scope='organization'`,
		pgx.NamedArgs{"id": uuid.New(), "role": role, "user": actor.ActorID, "org": actor.RootOrgID})
}

func deviceApproval(t *testing.T, id uuid.UUID) device.Approval {
	t.Helper()
	var raw []byte
	require.NoError(t, stack.DB().Primary().QueryRow(context.Background(), `SELECT approval FROM vaultix_device_authorizations WHERE id=@id`, pgx.NamedArgs{"id": id}).Scan(&raw))
	var approval device.Approval
	require.NoError(t, json.Unmarshal(raw, &approval))
	return approval
}

func TestDeviceAuthority_BuiltInAndFederatedSessions(t *testing.T) {
	for _, method := range []string{"email", "google", "github", "gitlab", "ldap", "oidc", "azure-saml", "okta-saml", "jumpcloud-saml", "google-saml", "keycloak-saml"} {
		t.Run(method, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			actor.AuthMethod = auth.ActorAuthMethod(method)
			f := nativeDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
			approval := deviceApproval(t, grant.ID)
			require.Equal(t, method, approval.AuthMethod)
			require.Equal(t, actor.ActorID, approval.UserID)
			require.Equal(t, actor.TokenVersionID, approval.SessionID)
			require.False(t, approval.SSOBypass)
			devicePollReady(t, grant.ID)
			_, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
			require.NoError(t, err)
			require.Equal(t, 1, deviceIssued(t, actor.ActorID))
			require.Empty(t, f.logs.String())
		})
	}
}

func TestDeviceAuthority_CurrentAccountAndTenant(t *testing.T) {
	for _, scenario := range []string{"locked", "temporary-lock", "ghost", "unaccepted", "session-version", "deleted-session", "inactive", "pending", "no-membership", "wrong-root", "wrong-org", "unknown-method", "mfa-required", "wrong-mfa", "unknown-mfa", "unverified-email"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			f := nativeDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			args := pgx.NamedArgs{"user": actor.ActorID, "session": actor.TokenVersionID, "org": actor.OrgID}
			var query string
			switch scenario {
			case "locked":
				query = `UPDATE users SET "isLocked"=true WHERE id=@user`
			case "temporary-lock":
				query = `UPDATE users SET "temporaryLockDateEnd"=clock_timestamp()+interval '1 hour' WHERE id=@user`
			case "ghost":
				query = `UPDATE users SET "isGhost"=true WHERE id=@user`
			case "unaccepted":
				query = `UPDATE users SET "isAccepted"=false WHERE id=@user`
			case "session-version":
				query = `UPDATE auth_token_sessions SET "accessVersion"=2 WHERE id=@session`
			case "deleted-session":
				query = `DELETE FROM auth_token_sessions WHERE id=@session`
			case "inactive":
				query = `UPDATE memberships SET "isActive"=false WHERE "actorUserId"=@user`
			case "pending":
				query = `UPDATE memberships SET status='invited' WHERE "actorUserId"=@user`
			case "no-membership":
				query = `DELETE FROM memberships WHERE "actorUserId"=@user`
			case "wrong-root":
				actor.RootOrgID = uuid.New()
			case "wrong-org":
				actor.OrgID = uuid.New()
			case "unknown-method":
				actor.AuthMethod = "unverified-method"
			case "mfa-required":
				query = `UPDATE organizations SET "enforceMfa"=true WHERE id=@org`
			case "wrong-mfa":
				query = `UPDATE organizations SET "enforceMfa"=true,"selectedMfaMethod"='totp' WHERE id=@org`
				actor.IsMfaVerified, actor.MfaMethod = true, "email"
			case "unknown-mfa":
				actor.IsMfaVerified, actor.MfaMethod = true, "unverified-factor"
			case "unverified-email":
				query = `UPDATE users SET "isEmailVerified"=false WHERE id=@user`
				actor.IsMfaVerified, actor.MfaMethod = true, "email"
			}
			if query != "" {
				devicePolicyExec(t, query, args)
			}
			require.ErrorIs(t, f.service.Approve(ctx, grant.UserCode, actor), device.ErrDenied)
			require.Equal(t, "pending", deviceState(t, grant.ID))
			require.Zero(t, deviceIssued(t, actor.ActorID))
		})
	}
}

func TestDeviceAuthority_RevocationBetweenApprovalAndRedemption(t *testing.T) {
	for _, scenario := range []string{"lock", "session-version", "inactive", "remove-membership", "sso-enforced", "mfa-enforced", "token-lifetime", "role-changed"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			deviceRole(t, actor, "member")
			f := nativeDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
			queries := map[string]string{
				"lock":              `UPDATE users SET "isLocked"=true WHERE id=@user`,
				"session-version":   `UPDATE auth_token_sessions SET "accessVersion"=2 WHERE id=@session`,
				"inactive":          `UPDATE memberships SET "isActive"=false WHERE "actorUserId"=@user`,
				"remove-membership": `DELETE FROM memberships WHERE "actorUserId"=@user`,
				"sso-enforced":      `UPDATE organizations SET "authEnforced"=true WHERE id=@org`,
				"mfa-enforced":      `UPDATE organizations SET "enforceMfa"=true WHERE id=@org`,
				"token-lifetime":    `UPDATE organizations SET "userTokenExpiration"='15m' WHERE id=@org`,
				"role-changed":      `UPDATE membership_roles SET role='admin' WHERE "membershipId" IN (SELECT id FROM memberships WHERE "actorUserId"=@user)`,
			}
			devicePolicyExec(t, queries[scenario], pgx.NamedArgs{"user": actor.ActorID, "session": actor.TokenVersionID, "org": actor.OrgID})
			devicePollReady(t, grant.ID)
			_, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
			require.ErrorIs(t, err, device.ErrDenied)
			require.Equal(t, "denied", deviceState(t, grant.ID))
			require.Zero(t, deviceIssued(t, actor.ActorID))
		})
	}
}

func TestDeviceAuthority_MethodEnforcementAndBypass(t *testing.T) {
	for _, scenario := range []struct {
		name, method, role string
		google, bypass     bool
		allowed            bool
	}{
		{"password-denied", "email", "admin", false, false, false},
		{"ldap-denied-by-effective-permission", "ldap", "member", false, false, false},
		{"oidc", "oidc", "member", false, false, true},
		{"saml", "okta-saml", "member", false, false, true},
		{"google", "google", "member", true, false, true},
		{"google-other-method", "oidc", "member", true, false, false},
		{"bypass-admin", "email", "admin", false, true, true},
		{"bypass-capability-unused", "oidc", "admin", false, true, true},
		{"bypass-non-admin", "email", "member", false, true, false},
		{"bypass-malformed-role", "email", "unknown", false, true, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			actor.AuthMethod = auth.ActorAuthMethod(scenario.method)
			deviceRole(t, actor, scenario.role)
			devicePolicyExec(t, `UPDATE organizations SET "authEnforced"=@saml,"googleSsoAuthEnforced"=@google,"bypassOrgAuthEnabled"=@bypass WHERE id=@org`, pgx.NamedArgs{"org": actor.OrgID, "saml": !scenario.google, "google": scenario.google, "bypass": scenario.bypass})
			f := nativeDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			err := f.service.Approve(ctx, grant.UserCode, actor)
			if !scenario.allowed {
				require.ErrorIs(t, err, device.ErrDenied)
				return
			}
			require.NoError(t, err)
			require.Equal(t, scenario.name == "bypass-admin", deviceApproval(t, grant.ID).SSOBypass)
			devicePollReady(t, grant.ID)
			_, err = f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
			require.NoError(t, err)
		})
	}
}

func TestDeviceAuthority_CustomDenyAndExpiredRole(t *testing.T) {
	for _, scenario := range []string{"custom-allow", "custom-deny", "expired", "malformed", "additional-deny"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			deviceRole(t, actor, "admin")
			devicePolicyExec(t, `UPDATE organizations SET "authEnforced"=true,"bypassOrgAuthEnabled"=true WHERE id=@org`, pgx.NamedArgs{"org": actor.OrgID})
			rules := `[["bypass-sso-enforcement","sso",0,1]]`
			if scenario == "custom-allow" {
				rules = `[["bypass-sso-enforcement","sso"]]`
			}
			if scenario == "malformed" {
				rules = `[["bypass-sso-enforcement","sso",42]]`
			}
			switch scenario {
			case "expired":
				devicePolicyExec(t, `UPDATE membership_roles SET "isTemporary"=true,"temporaryAccessEndTime"=clock_timestamp()-interval '1 second' WHERE "membershipId" IN (SELECT id FROM memberships WHERE "actorUserId"=@user)`, pgx.NamedArgs{"user": actor.ActorID})
			case "additional-deny":
				devicePolicyExec(t, `INSERT INTO additional_privileges(id,name,"actorUserId","orgId",permissions) VALUES(@id,'device-fixture',@user,@org,@rules)`, pgx.NamedArgs{"id": uuid.New(), "user": actor.ActorID, "org": actor.OrgID, "rules": rules})
			default:
				role := uuid.New()
				devicePolicyExec(t, `INSERT INTO roles(id,name,slug,"orgId",permissions) VALUES(@id,'Device fixture','device-fixture',@org,@rules)`, pgx.NamedArgs{"id": role, "org": actor.OrgID, "rules": rules})
				t.Cleanup(func() {
					devicePolicyExec(t, `DELETE FROM membership_roles WHERE "customRoleId"=@id`, pgx.NamedArgs{"id": role})
					devicePolicyExec(t, `DELETE FROM roles WHERE id=@id`, pgx.NamedArgs{"id": role})
				})
				devicePolicyExec(t, `INSERT INTO membership_roles(id,"membershipId",role,"customRoleId") SELECT @id,id,'custom',@role FROM memberships WHERE "actorUserId"=@user AND scope='organization'`, pgx.NamedArgs{"id": uuid.New(), "role": role, "user": actor.ActorID})
			}
			f := nativeDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			err := f.service.Approve(ctx, grant.UserCode, actor)
			if scenario == "custom-allow" {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, device.ErrDenied)
			}
		})
	}
}

func TestDeviceAuthority_GroupsAndDirectPrecedence(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	group, membership := uuid.New(), uuid.New()
	devicePolicyExec(t, `INSERT INTO groups(id,name,slug,"orgId") VALUES(@id,'Device fixture',@slug,@org)`, pgx.NamedArgs{"id": group, "slug": group.String(), "org": actor.OrgID})
	t.Cleanup(func() {
		devicePolicyExec(t, `DELETE FROM memberships WHERE "actorGroupId"=@id`, pgx.NamedArgs{"id": group})
		devicePolicyExec(t, `DELETE FROM user_group_membership WHERE "groupId"=@id`, pgx.NamedArgs{"id": group})
		devicePolicyExec(t, `DELETE FROM groups WHERE id=@id`, pgx.NamedArgs{"id": group})
	})
	devicePolicyExec(t, `INSERT INTO user_group_membership("userId","groupId") VALUES(@user,@group)`, pgx.NamedArgs{"user": actor.ActorID, "group": group})
	devicePolicyExec(t, `INSERT INTO memberships(id,scope,"scopeOrgId","actorGroupId","isActive") VALUES(@id,'organization',@org,@group,true)`, pgx.NamedArgs{"id": membership, "org": actor.OrgID, "group": group})
	devicePolicyExec(t, `INSERT INTO membership_roles(id,"membershipId",role) VALUES(@id,@member,'admin')`, pgx.NamedArgs{"id": uuid.New(), "member": membership})
	devicePolicyExec(t, `UPDATE organizations SET "authEnforced"=true,"bypassOrgAuthEnabled"=true WHERE id=@org`, pgx.NamedArgs{"org": actor.OrgID})
	f := nativeDeviceFixture(t, stack.DB())
	devicePolicyExec(t, `UPDATE memberships SET "isActive"=false WHERE "actorUserId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	denied := startDevice(t, f)
	require.ErrorIs(t, f.service.Approve(ctx, denied.UserCode, actor), device.ErrDenied)
	devicePolicyExec(t, `UPDATE memberships SET "isActive"=true,status='invited' WHERE "actorUserId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	require.ErrorIs(t, f.service.Approve(ctx, denied.UserCode, actor), device.ErrDenied)
	devicePolicyExec(t, `DELETE FROM memberships WHERE "actorUserId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	grant := startDevice(t, f)
	require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
	require.True(t, deviceApproval(t, grant.ID).SSOBypass)
	devicePolicyExec(t, `DELETE FROM user_group_membership WHERE "userId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	devicePollReady(t, grant.ID)
	_, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
	require.ErrorIs(t, err, device.ErrDenied)
	require.Zero(t, deviceIssued(t, actor.ActorID))
}

func TestDeviceAuthority_RootAndSubOrganization(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	child := uuid.New()
	devicePolicyExec(t, `INSERT INTO organizations(id,name,slug,"rootOrgId","parentOrgId","enforceMfa","selectedMfaMethod") VALUES(@id,'device-child',@slug,@root,@root,true,'totp')`, pgx.NamedArgs{"id": child, "slug": child.String(), "root": actor.RootOrgID})
	t.Cleanup(func() { devicePolicyExec(t, `DELETE FROM organizations WHERE id=@id`, pgx.NamedArgs{"id": child}) })
	devicePolicyExec(t, `INSERT INTO memberships(id,scope,"scopeOrgId","actorUserId",status) VALUES(@id,'organization',@org,@user,'accepted')`, pgx.NamedArgs{"id": uuid.New(), "org": child, "user": actor.ActorID})
	actor.OrgID = child
	devicePolicyExec(t, `UPDATE organizations SET "enforceMfa"=true WHERE id=@org`, pgx.NamedArgs{"org": actor.RootOrgID})
	actor.IsMfaVerified, actor.MfaMethod = true, "email"
	f := nativeDeviceFixture(t, stack.DB())
	grant := startDevice(t, f)
	require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
	devicePolicyExec(t, `UPDATE memberships SET "isActive"=false WHERE "actorUserId"=@user AND "scopeOrgId"=@root`, pgx.NamedArgs{"user": actor.ActorID, "root": actor.RootOrgID})
	devicePollReady(t, grant.ID)
	_, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
	require.ErrorIs(t, err, device.ErrDenied)
	devicePolicyExec(t, `UPDATE memberships SET "isActive"=true WHERE "actorUserId"=@user`, pgx.NamedArgs{"user": actor.ActorID})
	devicePolicyExec(t, `UPDATE organizations SET "authEnforced"=true WHERE id=@org`, pgx.NamedArgs{"org": child})
	grant = startDevice(t, f)
	require.ErrorIs(t, f.service.Approve(ctx, grant.UserCode, actor), device.ErrDenied)
	deviceRole(t, actor, "admin")
	devicePolicyExec(t, `UPDATE organizations SET "bypassOrgAuthEnabled"=true WHERE id=@org`, pgx.NamedArgs{"org": child})
	// Root administration does not grant the child's organization capability.
	require.ErrorIs(t, f.service.Approve(ctx, grant.UserCode, actor), device.ErrDenied)
	devicePolicyExec(t, `INSERT INTO membership_roles(id,"membershipId",role) SELECT @id,id,'admin' FROM memberships WHERE "actorUserId"=@user AND "scopeOrgId"=@org AND scope='organization'`, pgx.NamedArgs{"id": uuid.New(), "user": actor.ActorID, "org": child})
	require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
	require.True(t, deviceApproval(t, grant.ID).SSOBypass)
}

func TestDeviceAuthority_FactorLifecycleAndRootMFAOverride(t *testing.T) {
	for _, method := range []string{"email", "totp", "webauthn"} {
		t.Run(method, func(t *testing.T) {
			ctx, actor := newReauthenticationAccount(t)
			devicePolicyExec(t, `UPDATE users SET "isMfaEnabled"=true,"selectedMfaMethod"='totp' WHERE id=@user`, pgx.NamedArgs{"user": actor.ActorID})
			devicePolicyExec(t, `UPDATE organizations SET "enforceMfa"=true,"selectedMfaMethod"=@method WHERE id=@org`, pgx.NamedArgs{"org": actor.OrgID, "method": method})
			factor := uuid.New()
			switch method {
			case "totp":
				devicePolicyExec(t, `INSERT INTO totp_configs(id,"userId","isVerified","encryptedSecret") VALUES(@id,@user,true,@secret)`, pgx.NamedArgs{"id": factor, "user": actor.ActorID, "secret": []byte("encrypted-fixture-only")})
			case "webauthn":
				devicePolicyExec(t, `INSERT INTO webauthn_credentials(id,"userId","credentialId","publicKey") VALUES(@id,@user,@credential,'fixture-public-key')`, pgx.NamedArgs{"id": factor, "user": actor.ActorID, "credential": factor.String()})
			}
			actor.IsMfaVerified, actor.MfaMethod = true, method
			f := nativeDeviceFixture(t, stack.DB())
			grant := startDevice(t, f)
			require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
			devicePolicyExec(t, `UPDATE users SET "firstName"='profile-change' WHERE id=@user`, pgx.NamedArgs{"user": actor.ActorID})
			devicePollReady(t, grant.ID)
			_, err := f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
			require.NoError(t, err)
			grant = startDevice(t, f)
			require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
			switch method {
			case "email":
				devicePolicyExec(t, `UPDATE users SET "isEmailVerified"=false WHERE id=@user`, pgx.NamedArgs{"user": actor.ActorID})
			case "totp":
				devicePolicyExec(t, `UPDATE totp_configs SET "encryptedSecret"=@secret WHERE id=@id`, pgx.NamedArgs{"id": factor, "secret": []byte("replaced-encrypted-fixture")})
			case "webauthn":
				devicePolicyExec(t, `DELETE FROM webauthn_credentials WHERE id=@id`, pgx.NamedArgs{"id": factor})
			}
			devicePollReady(t, grant.ID)
			_, err = f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
			require.ErrorIs(t, err, device.ErrDenied)
			require.Equal(t, 1, deviceIssued(t, actor.ActorID))
			require.NotContains(t, f.logs.String(), "encrypted-fixture")
		})
	}
}

func TestDeviceAuthority_OneConnectionAndRollbackRecovery(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	cfg, err := pgxpool.ParseConfig(stack.Config().DBConnectionURI)
	require.NoError(t, err)
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	f := nativeDeviceFixture(t, &bindingDB{pool: pool})
	grant := startDevice(t, f)
	limited, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	require.NoError(t, f.service.Approve(limited, grant.UserCode, actor))
	devicePollReady(t, grant.ID)
	f.policy.issueError = device.ErrUnavailable
	_, err = f.service.Poll(limited, deviceRequest(), grant.DeviceCode)
	require.ErrorIs(t, err, device.ErrUnavailable)
	require.Equal(t, "approved", deviceState(t, grant.ID))
	require.Zero(t, deviceIssued(t, actor.ActorID))
	f.policy.issueError = nil
	_, err = f.service.Poll(limited, deviceRequest(), grant.DeviceCode)
	require.NoError(t, err)
	require.Equal(t, 1, deviceIssued(t, actor.ActorID))
}

func TestDeviceAuthority_LockedAccountDeadlineAndRecovery(t *testing.T) {
	ctx, actor := newReauthenticationAccount(t)
	f := nativeDeviceFixture(t, stack.DB())
	grant := startDevice(t, f)
	tx, err := stack.DB().Primary().Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE users SET "isLocked"=true WHERE id=@user`, pgx.NamedArgs{"user": actor.ActorID})
	require.NoError(t, err)
	limited, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	require.ErrorIs(t, f.service.Approve(limited, grant.UserCode, actor), device.ErrUnavailable)
	require.NoError(t, tx.Rollback(ctx))
	require.Equal(t, "pending", deviceState(t, grant.ID))
	require.NoError(t, f.service.Approve(ctx, grant.UserCode, actor))
	require.NotContains(t, f.logs.String(), actor.ActorID.String())
	require.NotContains(t, f.logs.String(), "SELECT")
	devicePollReady(t, grant.ID)
	_, err = f.service.Poll(ctx, deviceRequest(), grant.DeviceCode)
	require.NoError(t, err)
}
