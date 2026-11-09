package usersessions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/session"
)

var (
	userID  = uuid.MustParse("11111111-1111-4111-8111-111111111111")
	orgID   = uuid.MustParse("22222222-2222-4222-8222-222222222222")
	otherID = uuid.MustParse("33333333-3333-4333-8333-333333333333")
)

type fakeSessions struct {
	rows      []session.Session
	err       error
	revokedBy uuid.UUID
	revoked   uuid.UUID
	allBy     uuid.UUID
	logout    string
}

func (f *fakeSessions) List(_ context.Context, id uuid.UUID) ([]session.Session, error) {
	f.revokedBy = id
	return f.rows, f.err
}

func (f *fakeSessions) Revoke(_ context.Context, user, id uuid.UUID) error {
	f.revokedBy, f.revoked = user, id
	return f.err
}

func (f *fakeSessions) RevokeAll(_ context.Context, id uuid.UUID) error {
	f.allBy = id
	return f.err
}

func (f *fakeSessions) Logout(_ context.Context, token string) error {
	f.logout = token
	return f.err
}

type statusWriter struct{}

func (statusWriter) HandleError(w http.ResponseWriter, _ *http.Request, status int, err error) {
	var known *errutil.Error
	if errors.As(err, &known) && known.Status != 0 {
		status = known.Status
	}
	w.WriteHeader(status)
}

func serve(sessions Sessions, identity *auth.Identity, method, path string) *httptest.ResponseRecorder {
	router := chi.NewRouter()
	NewHandler(sessions, statusWriter{}).Register(router, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if identity != nil {
				r = r.WithContext(auth.WithIdentity(r.Context(), identity))
			}
			next.ServeHTTP(w, r)
		})
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(method, path, nil))
	return recorder
}

func person() *auth.Identity {
	return &auth.Identity{Actor: auth.ActorTypeUser, AuthMode: auth.AuthModeJWT, ActorID: userID, OrgID: orgID}
}

func TestListKeepsTheResponseTheApplicationAlwaysReturned(t *testing.T) {
	agent := "browser"
	used := time.Date(2026, 1, 2, 3, 4, 5, 678912000, time.FixedZone("elsewhere", 3600))
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	sessions := &fakeSessions{rows: []session.Session{
		{ID: otherID, IP: "203.0.113.9", UserAgent: &agent, RefreshVersion: 2, AccessVersion: 3, LastUsed: used, CreatedAt: created, UpdatedAt: created, UserID: userID},
		{ID: orgID, IP: "203.0.113.10", LastUsed: created, CreatedAt: created, UpdatedAt: created, UserID: userID},
	}}
	recorder := serve(sessions, person(), http.MethodGet, Path)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	var body []map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Len(t, body, 2)
	assert.Equal(t, map[string]any{
		"id": otherID.String(), "ip": "203.0.113.9", "userAgent": "browser", "refreshVersion": 2.0, "accessVersion": 3.0,
		"lastUsed": "2026-01-02T02:04:05.678Z", "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z", "userId": userID.String(),
	}, body[0])
	assert.Contains(t, body[1], "userAgent")
	assert.Nil(t, body[1]["userAgent"])
	assert.Equal(t, userID, sessions.revokedBy)
}

func TestListWithNoSessionsIsAnEmptyArray(t *testing.T) {
	recorder := serve(&fakeSessions{}, person(), http.MethodGet, Path)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, "[]", recorder.Body.String())
}

func TestRevokeUsesTheVerifiedUser(t *testing.T) {
	sessions := &fakeSessions{}
	recorder := serve(sessions, person(), http.MethodDelete, Path+"/"+otherID.String())
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"message":"Successfully revoked session"}`, recorder.Body.String())
	assert.Equal(t, userID, sessions.revokedBy)
	assert.Equal(t, otherID, sessions.revoked)
}

func TestRevokeAllUsesTheVerifiedUser(t *testing.T) {
	sessions := &fakeSessions{}
	recorder := serve(sessions, person(), http.MethodDelete, Path)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"message":"Successfully revoked all sessions"}`, recorder.Body.String())
	assert.Equal(t, userID, sessions.allBy)
}

func TestRevokeRefusesAnIDThatIsNotACanonicalUUID(t *testing.T) {
	for _, id := range []string{"not-a-uuid", strings.ReplaceAll(otherID.String(), "-", ""), "%7B" + otherID.String() + "%7D"} {
		sessions := &fakeSessions{}
		recorder := serve(sessions, person(), http.MethodDelete, Path+"/"+id)
		assert.Equal(t, http.StatusBadRequest, recorder.Code, id)
		assert.Equal(t, uuid.Nil, sessions.revoked, id)
	}
}

func TestOnlyAPersonsOrganizationSignInIsAccepted(t *testing.T) {
	withoutOrg := person()
	withoutOrg.OrgID = uuid.Nil
	machine := person()
	machine.Actor, machine.AuthMode = auth.ActorTypeIdentity, auth.AuthModeIdentityAccessToken
	device := person()
	device.AuthMode = auth.AuthModeDeviceAccess
	for name, identity := range map[string]*auth.Identity{"none": nil, "no organization": withoutOrg, "machine": machine, "device": device} {
		for _, request := range [][2]string{{http.MethodGet, Path}, {http.MethodDelete, Path}, {http.MethodDelete, Path + "/" + otherID.String()}} {
			sessions := &fakeSessions{}
			recorder := serve(sessions, identity, request[0], request[1])
			assert.Equal(t, http.StatusUnauthorized, recorder.Code, name)
			assert.Equal(t, uuid.Nil, sessions.revoked, name)
			assert.Equal(t, uuid.Nil, sessions.allBy, name)
		}
	}
}

func post(sessions Sessions, body string) *httptest.ResponseRecorder {
	router := chi.NewRouter()
	NewHandler(sessions, statusWriter{}).Register(router, func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, LogoutPath, strings.NewReader(body)))
	return recorder
}

func TestLogoutNeedsNoBearerAndPassesTheToken(t *testing.T) {
	sessions := &fakeSessions{}
	recorder := post(sessions, `{"refreshToken":"the-token"}`)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"message":"Successfully logged out"}`, recorder.Body.String())
	assert.Equal(t, "the-token", sessions.logout)
}

func TestLogoutWithAnUnreadableBodyStillSucceeds(t *testing.T) {
	for _, body := range []string{"", "not json", `{"refreshToken":7}`, strings.Repeat("x", maxLogoutBody+1)} {
		sessions := &fakeSessions{}
		assert.Equal(t, http.StatusOK, post(sessions, body).Code)
		assert.Empty(t, sessions.logout)
	}
}

func TestLogoutStoreFailureIsAServerError(t *testing.T) {
	recorder := post(&fakeSessions{err: errors.New("database detail")}, `{"refreshToken":"the-token"}`)
	assert.Equal(t, http.StatusInternalServerError, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), "database detail")
}

func TestStoreFailureIsAServerError(t *testing.T) {
	failing := &fakeSessions{err: errors.New("database detail")}
	for _, request := range [][2]string{{http.MethodGet, Path}, {http.MethodDelete, Path}, {http.MethodDelete, Path + "/" + otherID.String()}} {
		recorder := serve(failing, person(), request[0], request[1])
		assert.Equal(t, http.StatusInternalServerError, recorder.Code)
		assert.NotContains(t, recorder.Body.String(), "database detail")
	}
}
