//go:build integration

package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/server/api/platform/usersessions"
	"github.com/vaultix/api/internal/server/api/shared"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/internal/services/auth/session"
	"github.com/vaultix/api/tests/infra"
)

func sessionsServer(t *testing.T) (*httptest.Server, *session.Service) {
	t.Helper()
	service, err := session.NewService(&session.Deps{DB: stack.DB(), AuthSecret: infra.AuthSecret, KeyStore: memKeyStore})
	require.NoError(t, err)
	router := chi.NewRouter()
	usersessions.NewHandler(service, shared.NewErrorHandler(slog.New(slog.DiscardHandler))).Register(router,
		authenticator.RequireAuth(apiauth.WithAuthModes(apiauth.JWTAuth), apiauth.WithAssumePrivilege(false)))
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return server, service
}

func seedSession(t *testing.T, userID uuid.UUID, lastUsed, kind string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := stack.DB().Primary().Exec(context.Background(), `INSERT INTO auth_token_sessions(id,"userId",ip,"userAgent","accessVersion","refreshVersion","lastUsed","createdAt","updatedAt","sessionType")
 VALUES(@id,@user,'203.0.113.7',NULL,4,7,@used::timestamptz,@used::timestamptz,@used::timestamptz,@kind)`, pgx.NamedArgs{"id": id, "user": userID, "used": lastUsed, "kind": kind})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = stack.DB().Primary().Exec(context.Background(), `DELETE FROM auth_token_sessions WHERE id = @id`, pgx.NamedArgs{"id": id})
	})
	return id
}

func seedUser(t *testing.T) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	name := "sessions-" + uuid.NewString() + "@vaultix.invalid"
	err := stack.DB().Primary().QueryRow(context.Background(), `INSERT INTO users(username,email) VALUES(@name,@name) RETURNING id`, pgx.NamedArgs{"name": name}).Scan(&id)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = stack.DB().Primary().Exec(context.Background(), `DELETE FROM users WHERE id = @id`, pgx.NamedArgs{"id": id})
	})
	return id
}

func sessionExists(t *testing.T, id uuid.UUID) bool {
	t.Helper()
	var exists bool
	require.NoError(t, stack.DB().Primary().QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM auth_token_sessions WHERE id = @id)`, pgx.NamedArgs{"id": id}).Scan(&exists))
	return exists
}

func callSessions(t *testing.T, method, url, token string) (int, []byte) {
	t.Helper()
	request, err := http.NewRequestWithContext(context.Background(), method, url, http.NoBody)
	require.NoError(t, err)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	return response.StatusCode, body
}

func decodeSessions(t *testing.T, raw []byte) []map[string]any {
	t.Helper()
	var sessions []map[string]any
	require.NoError(t, json.Unmarshal(raw, &sessions), string(raw))
	return sessions
}

// The application's own route and the Go route read the same rows with the same
// real token, so any difference in fields, dates, order or scoping fails here.
func TestUserSessions_MatchesTheTypeScriptRoute(t *testing.T) {
	server, _ := sessionsServer(t)
	user := uuid.MustParse(stack.NodeJS().UserID())
	token := stack.NodeJS().UserToken()
	seedSession(t, user, "2020-01-02 03:04:05.678912+00", "browser")
	seedSession(t, user, "2020-02-02 03:04:05.1+00", "device-v1")
	seedSession(t, seedUser(t), "2030-01-01 00:00:00+00", "browser")

	typescriptStatus, typescriptBody := callSessions(t, http.MethodGet, stack.NodeJS().URL()+usersessions.Path, token)
	goStatus, goBody := callSessions(t, http.MethodGet, server.URL+usersessions.Path, token)

	require.Equal(t, http.StatusOK, typescriptStatus, string(typescriptBody))
	require.Equal(t, http.StatusOK, goStatus, string(goBody))
	expected, actual := decodeSessions(t, typescriptBody), decodeSessions(t, goBody)
	require.GreaterOrEqual(t, len(actual), 3)
	assert.Equal(t, expected, actual)
	for _, row := range actual {
		assert.NotContains(t, row, "sessionType")
		assert.Equal(t, user.String(), row["userId"], "Another user's session must never be listed")
	}
}

func TestUserSessions_RevokeMatchesTheTypeScriptRoute(t *testing.T) {
	server, _ := sessionsServer(t)
	user := uuid.MustParse(stack.NodeJS().UserID())
	token := stack.NodeJS().UserToken()
	path := usersessions.Path + "/"
	viaTypeScript := seedSession(t, user, "2020-03-01 00:00:00+00", "browser")
	viaGo := seedSession(t, user, "2020-03-02 00:00:00+00", "device-v1")
	foreign := seedSession(t, seedUser(t), "2020-03-03 00:00:00+00", "browser")

	typescriptStatus, typescriptBody := callSessions(t, http.MethodDelete, stack.NodeJS().URL()+path+viaTypeScript.String(), token)
	goStatus, goBody := callSessions(t, http.MethodDelete, server.URL+path+viaGo.String(), token)
	require.Equal(t, http.StatusOK, goStatus, string(goBody))
	assert.Equal(t, typescriptStatus, goStatus)
	assert.JSONEq(t, string(typescriptBody), string(goBody))
	assert.False(t, sessionExists(t, viaTypeScript))
	assert.False(t, sessionExists(t, viaGo))

	for _, id := range []uuid.UUID{foreign, uuid.New()} {
		typescriptStatus, typescriptBody = callSessions(t, http.MethodDelete, stack.NodeJS().URL()+path+id.String(), token)
		goStatus, goBody = callSessions(t, http.MethodDelete, server.URL+path+id.String(), token)
		assert.Equal(t, http.StatusOK, goStatus, string(goBody))
		assert.Equal(t, typescriptStatus, goStatus)
		assert.JSONEq(t, string(typescriptBody), string(goBody))
	}
	assert.True(t, sessionExists(t, foreign), "Another user's session must survive")
}

func TestUserSessions_RefusesWithoutASignIn(t *testing.T) {
	server, _ := sessionsServer(t)
	status, _ := callSessions(t, http.MethodGet, server.URL+usersessions.Path, "")
	assert.Equal(t, http.StatusUnauthorized, status)
	status, _ = callSessions(t, http.MethodDelete, server.URL+usersessions.Path, "")
	assert.Equal(t, http.StatusUnauthorized, status)
	status, _ = callSessions(t, http.MethodGet, server.URL+usersessions.Path, stack.NodeJS().IdentityToken())
	assert.Equal(t, http.StatusUnauthorized, status, "A machine identity has no personal sessions")
}

func TestUserSessions_RefusesAMalformedID(t *testing.T) {
	server, _ := sessionsServer(t)
	status, _ := callSessions(t, http.MethodDelete, server.URL+usersessions.Path+"/not-a-uuid", stack.NodeJS().UserToken())
	assert.Equal(t, http.StatusBadRequest, status)
}

// The calling session goes too, so this uses a separate user at the domain level.
func TestUserSessions_RevokeAllRemovesOnlyThatUsersSessions(t *testing.T) {
	_, service := sessionsServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	target := seedUser(t)
	browser := seedSession(t, target, "2020-04-01 00:00:00+00", "browser")
	device := seedSession(t, target, "2020-04-02 00:00:00+00", "device-v1")
	bystander := seedSession(t, seedUser(t), "2020-04-03 00:00:00+00", "browser")

	listed, err := service.List(ctx, target)
	require.NoError(t, err)
	require.Len(t, listed, 2)
	assert.Equal(t, device, listed[0].ID, "Most recently used comes first")
	assert.Nil(t, listed[0].UserAgent)

	require.NoError(t, service.RevokeAll(ctx, target))
	assert.False(t, sessionExists(t, browser))
	assert.False(t, sessionExists(t, device))
	assert.True(t, sessionExists(t, bystander))
	listed, err = service.List(ctx, target)
	require.NoError(t, err)
	assert.Empty(t, listed)
}

type browserSignIn struct {
	session uuid.UUID
	refresh string
}

// signIn creates a real session through the application. A distinct user agent
// keeps it from reusing an earlier session.
func signIn(t *testing.T) browserSignIn {
	t.Helper()
	var login infra.LoginResponse
	response, err := stack.NodeJS().Client().R().
		SetHeader("User-Agent", "session-test-"+uuid.NewString()).
		SetBody(infra.LoginRequest{Email: stack.NodeJS().UserEmail(), Password: "testpassword123"}).
		SetResult(&login).
		Post("/api/v3/auth/login")
	require.NoError(t, err)
	require.False(t, response.IsError(), response.String())
	claims := &apiauth.UserJWTClaims{}
	_, _, err = jwt.NewParser().ParseUnverified(login.AccessToken, claims)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = stack.DB().Primary().Exec(context.Background(), `DELETE FROM auth_token_sessions WHERE id = @id`, pgx.NamedArgs{"id": claims.TokenVersionID})
	})
	for _, cookie := range response.Cookies() {
		if cookie.Name == "jid" {
			return browserSignIn{session: claims.TokenVersionID, refresh: cookie.Value}
		}
	}
	require.Fail(t, "sign-in returned no refresh cookie")
	return browserSignIn{}
}

func sessionVersions(t *testing.T, id uuid.UUID) (int64, int64) {
	t.Helper()
	var access, refresh int64
	require.NoError(t, stack.DB().Primary().QueryRow(context.Background(), `SELECT "accessVersion", "refreshVersion" FROM auth_token_sessions WHERE id = @id`, pgx.NamedArgs{"id": id}).Scan(&access, &refresh))
	return access, refresh
}

func goLogout(t *testing.T, url, token string) (int, string) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"refreshToken": token})
	require.NoError(t, err)
	response, err := http.Post(url+usersessions.LogoutPath, "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	return response.StatusCode, string(raw)
}

func typescriptLogout(t *testing.T, token string) (int, string) {
	t.Helper()
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, stack.NodeJS().URL()+usersessions.LogoutPath, http.NoBody)
	require.NoError(t, err)
	request.AddCookie(&http.Cookie{Name: "jid", Value: token})
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	return response.StatusCode, string(raw)
}

func refreshToken(t *testing.T, secret string, user, sessionID uuid.UUID, version int64, change func(jwt.MapClaims)) string {
	t.Helper()
	claims := jwt.MapClaims{"authTokenType": "refreshToken", "userId": user.String(), "tokenVersionId": sessionID.String(), "refreshVersion": version, "exp": time.Now().Add(time.Hour).Unix()}
	if change != nil {
		change(claims)
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	require.NoError(t, err)
	return signed
}

func TestUserSessions_LogoutMatchesTheTypeScriptRoute(t *testing.T) {
	server, _ := sessionsServer(t)
	viaTypeScript, viaGo := signIn(t), signIn(t)
	beforeAccess, beforeRefresh := sessionVersions(t, viaGo.session)

	typescriptStatus, typescriptBody := typescriptLogout(t, viaTypeScript.refresh)
	goStatus, goBody := goLogout(t, server.URL, viaGo.refresh)

	require.Equal(t, http.StatusOK, goStatus, goBody)
	assert.Equal(t, typescriptStatus, goStatus)
	assert.JSONEq(t, typescriptBody, goBody)
	access, refresh := sessionVersions(t, viaGo.session)
	assert.Equal(t, []int64{beforeAccess + 1, beforeRefresh + 1}, []int64{access, refresh})
	access, refresh = sessionVersions(t, viaTypeScript.session)
	assert.Equal(t, []int64{beforeAccess + 1, beforeRefresh + 1}, []int64{access, refresh}, "Both routes must end the session the same way")
}

func TestUserSessions_LogoutOfAReusedTokenEndsTheSession(t *testing.T) {
	server, _ := sessionsServer(t)
	user := uuid.MustParse(stack.NodeJS().UserID())
	viaTypeScript, viaGo := signIn(t), signIn(t)
	_, current := sessionVersions(t, viaGo.session)
	_, _ = goLogout(t, server.URL, refreshToken(t, infra.AuthSecret, user, viaGo.session, current+5, nil))
	_, _ = typescriptLogout(t, refreshToken(t, infra.AuthSecret, user, viaTypeScript.session, current+5, nil))
	assert.False(t, sessionExists(t, viaGo.session))
	assert.False(t, sessionExists(t, viaTypeScript.session), "Both routes must treat a reused token the same way")
}

func TestUserSessions_LogoutWithinTheGraceWindowKeepsTheSession(t *testing.T) {
	server, _ := sessionsServer(t)
	ctx := context.Background()
	user := uuid.MustParse(stack.NodeJS().UserID())
	id := seedSession(t, user, "2020-05-01 00:00:00+00", "browser")
	key := "refresh-token-grace:" + id.String()
	require.NoError(t, memKeyStore.SetItem(ctx, key, "6"))

	status, body := goLogout(t, server.URL, refreshToken(t, infra.AuthSecret, user, id, 6, nil))
	require.Equal(t, http.StatusOK, status, body)
	access, refresh := sessionVersions(t, id)
	assert.Equal(t, []int64{5, 8}, []int64{access, refresh})
	remembered, err := memKeyStore.GetItem(ctx, key)
	require.NoError(t, err)
	assert.Empty(t, remembered, "Logout must clear the grace window")
}

func TestUserSessions_LogoutOutsideTheGraceWindowEndsTheSession(t *testing.T) {
	server, _ := sessionsServer(t)
	user := uuid.MustParse(stack.NodeJS().UserID())
	id := seedSession(t, user, "2020-05-02 00:00:00+00", "browser")
	require.NoError(t, memKeyStore.SetItem(context.Background(), "refresh-token-grace:"+id.String(), "5"))
	status, body := goLogout(t, server.URL, refreshToken(t, infra.AuthSecret, user, id, 6, nil))
	require.Equal(t, http.StatusOK, status, body)
	assert.False(t, sessionExists(t, id))
}

func TestUserSessions_LogoutIgnoresATokenThatProvesNothing(t *testing.T) {
	server, _ := sessionsServer(t)
	user := uuid.MustParse(stack.NodeJS().UserID())
	id := seedSession(t, user, "2020-05-03 00:00:00+00", "browser")
	foreign := seedUser(t)
	for name, token := range map[string]string{
		"empty":           "",
		"garbage":         "not-a-token",
		"wrong secret":    refreshToken(t, "another-secret-that-is-long-enough", user, id, 7, nil),
		"wrong type":      refreshToken(t, infra.AuthSecret, user, id, 7, func(c jwt.MapClaims) { c["authTokenType"] = "accessToken" }),
		"delegated":       refreshToken(t, infra.AuthSecret, user, id, 7, func(c jwt.MapClaims) { c["oauthClientId"] = "client" }),
		"expired":         refreshToken(t, infra.AuthSecret, user, id, 7, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }),
		"another user":    refreshToken(t, infra.AuthSecret, foreign, id, 7, nil),
		"unknown session": refreshToken(t, infra.AuthSecret, user, uuid.New(), 7, nil),
	} {
		status, body := goLogout(t, server.URL, token)
		require.Equal(t, http.StatusOK, status, name+": "+body)
		access, refresh := sessionVersions(t, id)
		assert.Equal(t, []int64{4, 7}, []int64{access, refresh}, name)
	}
}
