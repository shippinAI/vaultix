package vaultixref

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/vaultix-cloud/api/internal/libs/errutil"
	"github.com/vaultix-cloud/api/internal/services/auditlog"
	"github.com/vaultix-cloud/api/internal/services/auth"
	"github.com/vaultix-cloud/api/internal/services/secretmanager/reference"
)

type fakeReader struct {
	page    *reference.Page
	err     error
	reads   int
	seenOrg uuid.UUID
}

func (f *fakeReader) List(ctx context.Context, _ reference.Query) (*reference.Page, error) {
	f.reads++
	identity, err := auth.IdentityFromContext(ctx)
	if err == nil && identity != nil {
		f.seenOrg = identity.OrgID
	}
	return f.page, f.err
}

func (f *fakeReader) ListProjects(context.Context) (*reference.Projects, error) {
	f.reads++
	return &reference.Projects{Narration: "apps", Projects: []reference.Project{}}, f.err
}

type fakeAudit struct {
	calls int
	err   error
	body  string
}

func (f *fakeAudit) CreateAuditLog(_ context.Context, dto *auditlog.CreateAuditLogDTO) error {
	f.calls++
	raw, _ := json.Marshal(dto)
	f.body = string(raw)
	return f.err
}

func identityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good" {
			writePublicError(slog.Default(), w, r, errutil.Unauthorized("missing"))
			return
		}
		org := uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
		ctx := auth.WithIdentity(r.Context(), &auth.Identity{
			Actor: auth.ActorTypeUser, ActorID: uuid.MustParse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
			OrgID: org, AuthMode: auth.AuthModeJWT, IPAddress: "203.0.113.20",
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func newTestRouter(reader *fakeReader, auditor *fakeAudit, limiter *Limiter) http.Handler {
	router := chi.NewRouter()
	NewHandler(slog.New(slog.NewTextHandler(io.Discard, nil)), reader, auditor, limiter).Register(router, identityMiddleware)
	return router
}

func referenceRequest(remote string, headers map[string]string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/vaultix/secret-references?projectId=cccccccc-cccc-4ccc-8ccc-cccccccccccc&environment=dev", http.NoBody)
	request.RemoteAddr = remote
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	return request
}

func TestReferencesRejectMissingAuthAndSpoofedActorHeaders(t *testing.T) {
	reader := &fakeReader{page: &reference.Page{References: []reference.Reference{{Name: "CANARY_NAME"}}}}
	router := newTestRouter(reader, &fakeAudit{}, NewLimiter(nil))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, referenceRequest("203.0.113.10:443", map[string]string{
		"X-Actor-Id": "forged-actor", "X-Org-Id": "forged-org", "X-Real-Ip": "198.51.100.7",
	}))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", response.Code, response.Body.String())
	}
	if reader.reads != 0 || strings.Contains(response.Body.String(), "forged-actor") || strings.Contains(response.Body.String(), "CANARY") {
		t.Fatalf("unauthenticated request reached the reader or echoed input: %s", response.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body["error"] != messageUnauthorized {
		t.Fatalf("error shape: %s", response.Body.String())
	}
}

func TestReferencesUseAuthenticatedOrgAndHideForbiddenDetails(t *testing.T) {
	org := uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	reader := &fakeReader{err: errutil.Forbidden("project belongs to forged-org CANARY_VALUE")}
	router := newTestRouter(reader, &fakeAudit{}, NewLimiter(nil))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, referenceRequest("203.0.113.10:443", map[string]string{
		"Authorization": "Bearer good", "X-Org-Id": "forged-org", "X-Actor-Id": "forged-actor",
	}))
	if response.Code != http.StatusNotFound || reader.seenOrg != org {
		t.Fatalf("status %d org %s", response.Code, reader.seenOrg)
	}
	if strings.Contains(response.Body.String(), "CANARY_VALUE") || strings.Contains(response.Body.String(), "forged-org") {
		t.Fatalf("masked error leaked: %s", response.Body.String())
	}
}

func TestReferencesAuditMetadataAndContinueWhenDeliveryFails(t *testing.T) {
	reader := &fakeReader{page: &reference.Page{References: []reference.Reference{{Name: "VISIBLE"}}}}
	auditor := &fakeAudit{err: errutil.InternalServer("redis down CANARY_VALUE")}
	router := newTestRouter(reader, auditor, NewLimiter(nil))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, referenceRequest("203.0.113.10:443", map[string]string{"Authorization": "Bearer good"}))
	if response.Code != http.StatusOK || auditor.calls != 1 {
		t.Fatalf("status %d audits %d", response.Code, auditor.calls)
	}
	if strings.Contains(response.Body.String(), "CANARY_VALUE") || strings.Contains(auditor.body, "CANARY_VALUE") {
		t.Fatalf("value leaked into response or audit: %s %s", response.Body.String(), auditor.body)
	}
	if !strings.Contains(auditor.body, "get-secrets") || !strings.Contains(auditor.body, "203.0.113.20") {
		t.Fatalf("audit envelope: %s", auditor.body)
	}
}

func TestReferenceBudgetExhaustionAndLoopbackMcpDispatch(t *testing.T) {
	now := time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)
	limiter := NewLimiter(func() time.Time { return now })
	reader := &fakeReader{page: &reference.Page{References: []reference.Reference{}}}
	router := newTestRouter(reader, &fakeAudit{}, limiter)
	for range 60 {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, referenceRequest("203.0.113.10:443", map[string]string{"Authorization": "Bearer good"}))
		if response.Code != http.StatusOK {
			t.Fatalf("allowed request status %d", response.Code)
		}
	}
	blocked := httptest.NewRecorder()
	router.ServeHTTP(blocked, referenceRequest("203.0.113.10:443", map[string]string{
		"Authorization": "Bearer good", DispatchHeader: DispatchMCP,
	}))
	if blocked.Code != http.StatusTooManyRequests {
		t.Fatalf("public dispatch header skipped the budget: %d", blocked.Code)
	}
	internal := httptest.NewRecorder()
	router.ServeHTTP(internal, referenceRequest("127.0.0.1:4040", map[string]string{
		"Authorization": "Bearer good", DispatchHeader: DispatchMCP, "X-Real-Ip": "203.0.113.10",
	}))
	if internal.Code != http.StatusOK {
		t.Fatalf("loopback MCP dispatch was budgeted twice: %d %s", internal.Code, internal.Body.String())
	}
}

func TestCanceledReferenceReadDoesNotQuery(t *testing.T) {
	reader := &fakeReader{page: &reference.Page{}}
	handler := NewHandler(slog.New(slog.NewTextHandler(io.Discard, nil)), reader, &fakeAudit{}, NewLimiter(nil))
	request := referenceRequest("203.0.113.10:443", map[string]string{"Authorization": "Bearer good"})
	ctx, cancel := context.WithCancel(request.Context())
	cancel()
	request = request.WithContext(auth.WithIdentity(ctx, &auth.Identity{
		Actor: auth.ActorTypeUser, ActorID: uuid.MustParse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
		OrgID: uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), AuthMode: auth.AuthModeJWT,
	}))
	response := httptest.NewRecorder()
	handler.References(response, request)
	if response.Code != http.StatusInternalServerError || reader.reads != 0 {
		t.Fatalf("canceled status %d reads %d", response.Code, reader.reads)
	}
}
