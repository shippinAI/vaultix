//go:build integration

package permission_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/server/api/shared"
	"github.com/vaultix/api/internal/services/assumeprivilege"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/internal/services/permission"
	"github.com/vaultix/api/internal/services/permission/secretmanager"
	"github.com/vaultix/api/tests/infra"
)

const assumedCookie = "vaultix-project-assume-privileges"

type assumedOutcome struct {
	status                                         int
	assumed, describe, argumentsPreserved, cleared bool
}

func applicationGrant(t *testing.T, project string, actor auth.ActorType, actorID string) string {
	t.Helper()
	body, err := json.Marshal(map[string]string{"actorType": string(actor), "actorId": actorID})
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, stack.NodeJS().URL()+"/api/v1/projects/"+project+"/assume-privileges", bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+stack.NodeJS().UserToken())
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(req)
	require.NoError(t, err)
	defer response.Body.Close()
	_, err = io.Copy(io.Discard, response.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode)
	for _, cookie := range response.Cookies() {
		if cookie.Name != assumedCookie {
			continue
		}
		require.True(t, cookie.HttpOnly)
		require.Equal(t, "/api", cookie.Path)
		require.Equal(t, 3600, cookie.MaxAge)
		require.NotEmpty(t, cookie.Value)
		return cookie.Value
	}
	t.Fatal("Application did not issue an assumed-privilege cookie")
	return ""
}

// Only explicit malformed-claim fixtures are re-signed; ordinary grants come
// from the real application. No fixture token or cookie is recorded.
func changedGrant(t *testing.T, grant string, change func(jwt.MapClaims)) string {
	t.Helper()
	parsed, err := jwt.Parse(grant, func(_ *jwt.Token) (any, error) { return []byte(infra.AuthSecret), nil }, jwt.WithValidMethods([]string{"HS256"}))
	require.NoError(t, err)
	claims, ok := parsed.Claims.(jwt.MapClaims)
	require.True(t, ok)
	change(claims)
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(infra.AuthSecret))
	require.NoError(t, err)
	return token
}

func assumedRequest(t *testing.T, svc *permission.Service, project, grant string, enabled, bearer bool) assumedOutcome {
	t.Helper()
	logger := infra.NopLogger()
	errors := shared.NewErrorHandler(logger)
	verifier := assumeprivilege.NewService(context.Background(), logger, &assumeprivilege.Deps{AuthSecret: infra.AuthSecret, PermissionService: svc})
	authenticator, err := apiauth.NewApiAuthenticator(context.Background(), logger, &apiauth.AuthenticatorDeps{
		DB: stack.DB(), AuthSecret: infra.AuthSecret, KeyStore: keystore.NewMemoryKeyStore(), AssumePrivilege: verifier, ErrorHandler: errors, IdentityPolicy: stack.Config().IdentityTokenPolicy,
	})
	require.NoError(t, err)
	outcome := assumedOutcome{}
	// This probe composes actual native middleware/domain services; it is not a
	// new production route and never fetches or decrypts a secret.
	handler := authenticator.RequireAuth(apiauth.WithAuthModes(apiauth.JWTAuth), apiauth.WithAssumePrivilege(enabled))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, identityErr := auth.IdentityFromContext(r.Context())
		require.NoError(t, identityErr)
		outcome.assumed = auth.AssumedPrivilegeFromContext(r.Context()) != nil
		args := permission.GetProjectPermissionArgs{Actor: identity.Actor, ActorID: identity.ActorID, ActorOrgID: identity.OrgID, ActorAuthMethod: identity.AuthMethod, ProjectID: project, ActionProjectType: permission.ActionProjectTypeSecretManager}
		before := args
		result, permissionErr := svc.GetProjectPermission(r.Context(), &args)
		outcome.argumentsPreserved = args == before
		if permissionErr != nil {
			errors.HandleError(w, r, 500, permissionErr)
			return
		}
		outcome.describe = secretmanager.NewSecretAccessChecker(result.Permission.Ability).CanDescribeSecret("dev", "/", "REFERENCE", nil)
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "http://vaultix.test/proof/authority", http.NoBody)
	if bearer {
		request.Header.Set("Authorization", "Bearer "+stack.NodeJS().UserToken())
	}
	if grant != "" {
		request.AddCookie(&http.Cookie{Name: assumedCookie, Value: grant})
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	response := recorder.Result()
	defer response.Body.Close()
	outcome.status = response.StatusCode
	for _, cookie := range response.Cookies() {
		if cookie.Name == assumedCookie && cookie.MaxAge < 0 {
			outcome.cleared = true
		}
	}
	if outcome.status >= 400 {
		var body map[string]any
		require.NoError(t, json.NewDecoder(response.Body).Decode(&body))
		errorText, ok := body["error"].(string)
		require.True(t, ok)
		require.NotEmpty(t, errorText)
	}
	return outcome
}

func TestAssumedAuthority_ApplicationGrants(t *testing.T) {
	actors := authorityActors(t)
	node := stack.NodeJS()
	targetUser := node.InviteAndCreateUser(t, "assume-"+uuid.NewString()+"@example.invalid")
	node.AddUserToProject(t, actors[0].ProjectID, targetUser.Email, []string{"admin"})
	otherProject := node.CreateProject(t, "assume-other-"+uuid.NewString()[:8])
	t.Cleanup(func() { node.DeleteProject(t, otherProject.ID) })
	for _, target := range []struct {
		actor  auth.ActorType
		id     string
		column string
	}{
		{auth.ActorTypeUser, targetUser.ID, "actorUserId"}, {auth.ActorTypeIdentity, actors[1].ActorID.String(), "actorIdentityId"},
	} {
		t.Run(string(target.actor), func(t *testing.T) {
			issued := applicationGrant(t, actors[0].ProjectID, target.actor, target.id)
			for _, name := range []string{"valid", "no-cookie", "malformed", "missing-expiry", "missing-issued-at", "wrong-session", "wrong-requester", "unsupported-target", "expired", "disabled", "no-bearer", "other-project", "requester-role-revoked", "requester-membership-removed", "target-membership-removed", "target-role-granted", "sso-enabled", "tenant-changed", "primary-unavailable"} {
				t.Run(name, func(t *testing.T) {
					db, svc := newPermissionAuthority(t, func(pool *pgxpool.Pool) {
						permissionExec(t, pool, `UPDATE membership_roles SET role='no-access' WHERE "membershipId" IN (SELECT id FROM memberships WHERE "scopeProjectId"=$1 AND "`+target.column+`"=$2)`, actors[0].ProjectID, target.id)
					})
					valid := assumedOutcome{status: http.StatusNoContent, assumed: true, argumentsPreserved: true}
					assert.Equal(t, valid, assumedRequest(t, svc, actors[0].ProjectID, issued, true, true), "valid before mutation")
					expected := valid
					grant, project := issued, actors[0].ProjectID
					enabled, bearer := true, true
					primary := db.primary
					switch name {
					case "no-cookie":
						grant = ""
						expected.assumed = false
						expected.describe = true
					case "malformed":
						grant = "invalid-grant"
						expected.assumed = false
						expected.describe = true
						expected.cleared = true
					case "missing-expiry", "missing-issued-at", "wrong-session", "wrong-requester", "unsupported-target", "expired":
						grant = changedGrant(t, issued, func(claims jwt.MapClaims) {
							switch name {
							case "missing-expiry":
								delete(claims, "exp")
							case "missing-issued-at":
								delete(claims, "iat")
							case "wrong-session":
								claims["tokenVersionId"] = uuid.NewString()
							case "wrong-requester":
								claims["requesterId"] = targetUser.ID
							case "unsupported-target":
								claims["actorType"] = "unknown"
							case "expired":
								claims["exp"] = time.Now().Add(-time.Minute).Unix()
							}
						})
						expected.assumed = false
						expected.describe = true
						expected.cleared = true
					case "disabled":
						enabled = false
						expected.assumed = false
						expected.describe = true
					case "no-bearer":
						bearer = false
						expected = assumedOutcome{status: 401}
					case "other-project":
						project = otherProject.ID
						expected.describe = true
					case "requester-role-revoked":
						permissionExec(t, db.primary, `UPDATE membership_roles SET role='no-access' WHERE "membershipId" IN (SELECT id FROM memberships WHERE "scopeProjectId"=$1 AND "actorUserId"=$2)`, project, actors[0].ActorID)
						expected.assumed = false
						expected.cleared = true
					case "requester-membership-removed":
						permissionExec(t, db.primary, `DELETE FROM memberships WHERE "scopeProjectId"=$1 AND "actorUserId"=$2`, project, actors[0].ActorID)
						expected.assumed = false
						expected.cleared = true
						expected.status = 403
					case "target-membership-removed":
						permissionExec(t, db.primary, `DELETE FROM memberships WHERE "scopeProjectId"=$1 AND "`+target.column+`"=$2`, project, target.id)
						expected.status = 403
					case "target-role-granted":
						permissionExec(t, db.primary, `UPDATE membership_roles SET role='viewer' WHERE "membershipId" IN (SELECT id FROM memberships WHERE "scopeProjectId"=$1 AND "`+target.column+`"=$2)`, project, target.id)
						expected.describe = true
					case "sso-enabled":
						setSSOPolicy(t, db.primary, actors[0].ActorOrgID, true, false, false)
						expected.assumed = false
						expected.cleared = true
						expected.status = 403
					case "tenant-changed":
						permissionExec(t, db.primary, `UPDATE projects SET "orgId"=$2 WHERE id=$1`, project, uuid.New())
						expected.assumed = false
						expected.cleared = true
						expected.status = 403
					case "primary-unavailable":
						db.primary = db.unavailable
						expected.assumed = false
						expected.cleared = true
						expected.status = 500
					}
					assert.Equal(t, expected, assumedRequest(t, svc, project, grant, enabled, bearer))
					require.Zero(t, db.replicaReads)
					if name == "primary-unavailable" {
						db.primary = primary
						assert.Equal(t, valid, assumedRequest(t, svc, project, issued, true, true))
					}
				})
			}
		})
	}
}

func TestAssumedAuthority_NativeGrantCompatibility(t *testing.T) {
	node := stack.NodeJS()
	project := node.CreateProject(t, "native-grant-"+uuid.NewString()[:8])
	t.Cleanup(func() { node.DeleteProject(t, project.ID) })
	identity := node.CreateIdentity(t, "native-grant-"+uuid.NewString())
	t.Cleanup(func() { node.DeleteIdentity(t, identity.ID) })
	node.AddIdentityToProject(t, project.ID, identity.ID, infra.Role("no-access"))
	member := node.InviteAndCreateUser(t, "native-grant-"+uuid.NewString()+"@example.invalid")
	node.AddUserToProject(t, project.ID, member.Email, []string{"no-access"})
	permissions := newPermissionService()
	service := assumeprivilege.NewService(context.Background(), infra.NopLogger(), &assumeprivilege.Deps{AuthSecret: infra.AuthSecret, PermissionService: permissions})
	authenticator, err := apiauth.NewApiAuthenticator(context.Background(), infra.NopLogger(), &apiauth.AuthenticatorDeps{DB: stack.DB(), AuthSecret: infra.AuthSecret, KeyStore: keystore.NewMemoryKeyStore(), AssumePrivilege: service, ErrorHandler: shared.NewErrorHandler(infra.NopLogger()), IdentityPolicy: stack.Config().IdentityTokenPolicy})
	require.NoError(t, err)
	requester, err := authenticator.ValidateJWT(context.Background(), node.UserToken())
	require.NoError(t, err)
	probe := func(grant string) int {
		req, requestErr := http.NewRequestWithContext(context.Background(), http.MethodGet, node.URL()+"/api/v1/projects/"+project.ID+"/memberships", http.NoBody)
		require.NoError(t, requestErr)
		req.Header.Set("Authorization", "Bearer "+node.UserToken())
		if grant != "" {
			req.AddCookie(&http.Cookie{Name: assumedCookie, Value: grant})
		}
		client := &http.Client{Timeout: 30 * time.Second}
		response, responseErr := client.Do(req)
		require.NoError(t, responseErr)
		defer response.Body.Close()
		_, copyErr := io.Copy(io.Discard, response.Body)
		require.NoError(t, copyErr)
		for _, cookie := range response.Cookies() {
			require.False(t, cookie.Name == assumedCookie && cookie.MaxAge < 0, "Valid native grant must not be rejected by the application")
		}
		return response.StatusCode
	}
	require.Equal(t, 200, probe(""))
	for _, target := range []struct {
		actor auth.ActorType
		id    string
	}{{auth.ActorTypeUser, member.ID}, {auth.ActorTypeIdentity, identity.ID}} {
		t.Run(string(target.actor), func(t *testing.T) {
			grant, mintErr := service.AssumeProjectPrivileges(context.Background(), &assumeprivilege.AssumeProjectPrivilegesOpts{TargetActorType: target.actor, TargetActorID: uuid.MustParse(target.id), RequesterID: requester.ActorID, RequesterOrgID: requester.OrgID, TokenVersionID: requester.TokenVersionID, ProjectID: project.ID, AuthMethod: requester.AuthMethod})
			require.NoError(t, mintErr)
			require.Equal(t, 403, probe(grant.AssumePrivilegesToken), "Existing HTTP policy must apply the no-access target rather than requester admin authority")
			require.Equal(t, assumedOutcome{status: 204, assumed: true, argumentsPreserved: true}, assumedRequest(t, permissions, project.ID, grant.AssumePrivilegesToken, true, true))
		})
	}
}

func TestAssumedAuthority_RevokedSession(t *testing.T) {
	actors := authorityActors(t)
	grant := applicationGrant(t, actors[0].ProjectID, auth.ActorTypeIdentity, actors[1].ActorID.String())
	service := newPermissionService()
	valid := assumedOutcome{status: 204, assumed: true, describe: true, argumentsPreserved: true}
	require.Equal(t, valid, assumedRequest(t, service, actors[0].ProjectID, grant, true, true))
	parsed, err := jwt.Parse(grant, func(_ *jwt.Token) (any, error) { return []byte(infra.AuthSecret), nil }, jwt.WithValidMethods([]string{"HS256"}))
	require.NoError(t, err)
	claims, ok := parsed.Claims.(jwt.MapClaims)
	require.True(t, ok)
	session, ok := claims["tokenVersionId"].(string)
	require.True(t, ok)
	var version int
	require.NoError(t, stack.DB().Primary().QueryRow(context.Background(), `SELECT "accessVersion" FROM auth_token_sessions WHERE id=$1`, session).Scan(&version))
	restore := func() {
		permissionExec(t, stack.DB().Primary(), `UPDATE auth_token_sessions SET "accessVersion"=$2 WHERE id=$1`, session, version)
	}
	t.Cleanup(restore)
	// Mutate only the disposable issuer session. This is database revocation
	// evidence, not a claim about the logout UI or a live Nomen issuer.
	permissionExec(t, stack.DB().Primary(), `UPDATE auth_token_sessions SET "accessVersion"=$2 WHERE id=$1`, session, version+1)
	require.Equal(t, assumedOutcome{status: 401}, assumedRequest(t, service, actors[0].ProjectID, grant, true, true))
	restore()
	require.Equal(t, valid, assumedRequest(t, service, actors[0].ProjectID, grant, true, true))
}
