// Package usersessions serves a signed-in user's own sessions over HTTP.
package usersessions

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/vaultix-cloud/api/internal/libs/errutil"
	"github.com/vaultix-cloud/api/internal/services/auth"
	"github.com/vaultix-cloud/api/internal/services/auth/session"
)

const (
	Path           = "/api/v2/users/me/sessions"
	LogoutPath     = "/api/v1/auth/logout"
	maxLogoutBody  = 16 * 1024
	requestTimeout = 5 * time.Second
	// The form the application has always returned for these dates.
	timestampFormat = "2006-01-02T15:04:05.000Z"
)

// Sessions is the session domain. The user always comes from the verified
// token, never from the request.
type Sessions interface {
	List(context.Context, uuid.UUID) ([]session.Session, error)
	Revoke(ctx context.Context, userID, sessionID uuid.UUID) error
	RevokeAll(context.Context, uuid.UUID) error
	Logout(ctx context.Context, refreshToken string) error
}

type ErrorWriter interface {
	HandleError(w http.ResponseWriter, r *http.Request, statusCode int, err error)
}

type Handler struct {
	sessions Sessions
	errors   ErrorWriter
}

func NewHandler(sessions Sessions, errors ErrorWriter) *Handler {
	return &Handler{sessions: sessions, errors: errors}
}

func (h *Handler) Register(router chi.Router, authenticate func(http.Handler) http.Handler) {
	router.Post(LogoutPath, h.logout)
	router.Group(func(r chi.Router) {
		r.Use(authenticate)
		r.Get(Path, h.list)
		r.Delete(Path, h.revokeAll)
		r.Delete(Path+"/{sessionId}", h.revoke)
	})
}

type sessionResponse struct {
	ID             uuid.UUID `json:"id"`
	IP             string    `json:"ip"`
	UserAgent      *string   `json:"userAgent"`
	RefreshVersion int64     `json:"refreshVersion"`
	AccessVersion  int64     `json:"accessVersion"`
	LastUsed       string    `json:"lastUsed"`
	CreatedAt      string    `json:"createdAt"`
	UpdatedAt      string    `json:"updatedAt"`
	UserID         uuid.UUID `json:"userId"`
}

func timestamp(t time.Time) string {
	return t.UTC().Format(timestampFormat)
}

// actor accepts only a person's organization-scoped sign-in, which is what
// these routes have always required.
func actor(r *http.Request) (uuid.UUID, error) {
	identity, err := auth.IdentityFromContext(r.Context())
	if err != nil || identity == nil || identity.Actor != auth.ActorTypeUser || identity.AuthMode != auth.AuthModeJWT || identity.OrgID == uuid.Nil {
		return uuid.Nil, errutil.Unauthorized("Sign in to manage your sessions.")
	}
	return identity.ActorID, nil
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, err := actor(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusUnauthorized, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	sessions, err := h.sessions.List(ctx, userID)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	response := make([]sessionResponse, 0, len(sessions))
	for i := range sessions {
		s := &sessions[i]
		response = append(response, sessionResponse{
			ID: s.ID, IP: s.IP, UserAgent: s.UserAgent, RefreshVersion: s.RefreshVersion, AccessVersion: s.AccessVersion,
			LastUsed: timestamp(s.LastUsed), CreatedAt: timestamp(s.CreatedAt), UpdatedAt: timestamp(s.UpdatedAt), UserID: s.UserID,
		})
	}
	writeJSON(w, response)
}

func (h *Handler) revokeAll(w http.ResponseWriter, r *http.Request) {
	userID, err := actor(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusUnauthorized, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	if err := h.sessions.RevokeAll(ctx, userID); err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]string{"message": "Successfully revoked all sessions"})
}

func (h *Handler) revoke(w http.ResponseWriter, r *http.Request) {
	userID, err := actor(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusUnauthorized, err)
		return
	}
	raw := strings.TrimSpace(chi.URLParam(r, "sessionId"))
	sessionID, err := uuid.Parse(raw)
	if err != nil || len(raw) != len(uuid.Nil.String()) {
		h.errors.HandleError(w, r, http.StatusBadRequest, errutil.BadRequest("Invalid session ID."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	if err := h.sessions.Revoke(ctx, userID, sessionID); err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]string{"message": "Successfully revoked session"})
}

// logout has no bearer to check: the refresh token is the credential, and an
// unusable one changes nothing.
func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, maxLogoutBody)).Decode(&body)
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	if err := h.sessions.Logout(ctx, body.RefreshToken); err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]string{"message": "Successfully logged out"})
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(body)
}
