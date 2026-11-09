package vaultixref

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/services/auditlog"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/secretmanager/reference"
)

// Reader is the native reference service. Actor identity comes from the
// authenticated context, never from a client header.
type Reader interface {
	List(context.Context, reference.Query) (*reference.Page, error)
	ListProjects(context.Context) (*reference.Projects, error)
}

// Auditor records a metadata-only reference read. A delivery failure must not
// change the read response; the request path is at-most-once.
type Auditor interface {
	CreateAuditLog(context.Context, *auditlog.CreateAuditLogDTO) error
}

type Handler struct {
	logger  *slog.Logger
	reader  Reader
	auditor Auditor
	limiter *Limiter
}

func NewHandler(logger *slog.Logger, reader Reader, auditor Auditor, limiter *Limiter) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	if limiter == nil {
		limiter = NewLimiter(nil)
	}
	return &Handler{logger: logger, reader: reader, auditor: auditor, limiter: limiter}
}

func (h *Handler) Register(router chi.Router, authenticate func(http.Handler) http.Handler) {
	router.Group(func(r chi.Router) {
		if authenticate != nil {
			r.Use(authenticate)
		}
		r.Get("/api/v1/vaultix/projects", h.Projects)
		r.Get("/api/v1/vaultix/secret-references", h.References)
	})
}

func (h *Handler) Projects(w http.ResponseWriter, r *http.Request) {
	if err := r.Context().Err(); err != nil {
		writePublicError(h.logger, w, r, errutil.InternalServer("Reference service is unavailable."))
		return
	}
	if len(r.URL.Query()) != 0 {
		writePublicError(h.logger, w, r, errutil.BadRequest("Invalid Vaultix request."))
		return
	}
	if _, err := h.actor(r); err != nil {
		writePublicError(h.logger, w, r, err)
		return
	}
	if err := h.limiter.Allow(r, "projects", ProjectBudget); err != nil {
		writePublicError(h.logger, w, r, err)
		return
	}
	page, err := h.reader.ListProjects(r.Context())
	if err != nil {
		writePublicError(h.logger, w, r, err)
		return
	}
	writeJSON(w, page)
}

func (h *Handler) References(w http.ResponseWriter, r *http.Request) {
	if err := r.Context().Err(); err != nil {
		writePublicError(h.logger, w, r, errutil.InternalServer("Reference service is unavailable."))
		return
	}
	query, err := referenceQuery(r)
	if err != nil {
		writePublicError(h.logger, w, r, err)
		return
	}
	identity, err := h.actor(r)
	if err != nil {
		writePublicError(h.logger, w, r, err)
		return
	}
	if err := h.limiter.Allow(r, "references", ReferenceBudget); err != nil {
		writePublicError(h.logger, w, r, err)
		return
	}
	page, err := h.reader.List(r.Context(), query)
	if err != nil {
		writePublicError(h.logger, w, r, err)
		return
	}
	h.record(r.Context(), identity, query, len(page.References))
	writeJSON(w, page)
}

func (h *Handler) actor(r *http.Request) (*auth.Identity, error) {
	identity, err := auth.IdentityFromContext(r.Context())
	if err != nil || identity == nil {
		return nil, errutil.Unauthorized("Sign in to access your vault.")
	}
	user := identity.Actor == auth.ActorTypeUser && identity.AuthMode == auth.AuthModeJWT
	machine := identity.Actor == auth.ActorTypeIdentity && identity.AuthMode == auth.AuthModeIdentityAccessToken
	if !user && !machine {
		return nil, errutil.Unauthorized("Sign in to access your vault.")
	}
	return identity, nil
}

func (h *Handler) record(ctx context.Context, identity *auth.Identity, query reference.Query, count int) {
	if h.auditor == nil {
		return
	}
	info := auditlog.BuildAuditLogInfo(identity)
	if info == nil {
		return
	}
	orgID := identity.OrgID
	projectID := query.ProjectID
	err := h.auditor.CreateAuditLog(ctx, &auditlog.CreateAuditLogDTO{
		Event: auditlog.Event{Metadata: auditlog.GetSecretsEventMetadata{
			Environment: query.Environment, SecretPath: query.SecretPath, NumberOfSecrets: count,
		}},
		Actor: info.Actor, OrgID: &orgID, ProjectID: &projectID,
		IPAddress: info.IPAddress, UserAgent: info.UserAgent, UserAgentType: info.UserAgentType,
	})
	if err != nil && ctx.Err() == nil {
		h.logger.ErrorContext(ctx, "dropped reference audit log", slog.String("errorType", errorName(err)))
	}
}

func referenceQuery(r *http.Request) (reference.Query, error) {
	var query reference.Query
	allowed := map[string]bool{"projectId": true, "environment": true, "secretPath": true, "offset": true, "limit": true}
	for key := range r.URL.Query() {
		if !allowed[key] {
			return query, errutil.BadRequest("Invalid Vaultix request.")
		}
	}
	query.ProjectID = r.URL.Query().Get("projectId")
	query.Environment = r.URL.Query().Get("environment")
	query.SecretPath = r.URL.Query().Get("secretPath")
	if query.SecretPath == "" {
		query.SecretPath = "/"
	}
	var err error
	query.Offset, err = boundedInteger(r.URL.Query().Get("offset"), 0, 0, 1000000)
	if err != nil {
		return query, err
	}
	query.Limit, err = boundedInteger(r.URL.Query().Get("limit"), 50, 1, 100)
	if err != nil {
		return query, err
	}
	return query, nil
}

func boundedInteger(raw string, fallback, min, max int) (int, error) {
	if raw == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < min || parsed > max {
		return 0, errutil.BadRequest("Invalid Vaultix request.")
	}
	return parsed, nil
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(body)
}
