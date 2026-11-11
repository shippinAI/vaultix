// Package assistant serves the in-app assistant at /api/vx/v1/ai (docs/0123,
// docs/0124): AI providers and personas managed by instance administrators, and
// chat for any signed-in person.
package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/vaultix-cloud/api/internal/libs/errutil"
	"github.com/vaultix-cloud/api/internal/libs/requestid"
	"github.com/vaultix-cloud/api/internal/services/assistant"
	"github.com/vaultix-cloud/api/internal/services/auth"
)

const (
	Prefix           = "/api/vx/v1/ai"
	maxAdminBody     = 32 * 1024
	maxMessageBody   = 256 * 1024
	adminTimeout     = 10 * time.Second
	testTimeout      = 45 * time.Second
	messageTimeout   = 110 * time.Second
	messagesPerUser  = 20
	messageWindow    = time.Minute
	testPrompt       = "Reply with the single word OK."
	unavailableModel = "No AI provider is active. An instance administrator can set one under Admin > AI assistant."
)

// Providers is the provider store.
type Providers interface {
	List(context.Context) ([]assistant.Provider, error)
	Active(context.Context) (*assistant.Provider, *assistant.Credential, error)
	ProviderWithCredential(context.Context, uuid.UUID) (*assistant.Provider, *assistant.Credential, error)
	Create(context.Context, *assistant.ProviderInput) (*assistant.Provider, error)
	Update(context.Context, uuid.UUID, *assistant.ProviderInput) (*assistant.Provider, error)
	Delete(context.Context, uuid.UUID) (*assistant.Provider, error)
	RecordTest(ctx context.Context, id uuid.UUID, passed bool, message string, at time.Time) (*assistant.Provider, error)
}

// Personas is the persona registry.
type Personas interface {
	List(context.Context) ([]assistant.Persona, error)
	Create(context.Context, *assistant.PersonaInput) (*assistant.Persona, error)
	Update(context.Context, string, *assistant.PersonaInput) (*assistant.Persona, error)
	Reset(context.Context, string) (*assistant.Persona, error)
	Delete(context.Context, string) (*assistant.Persona, error)
}

// Answerer routes and answers one chat turn.
type Answerer interface {
	Answer(ctx context.Context, personas []assistant.Persona, models assistant.ModelSource, bearer string, request *assistant.MessageRequest) (*assistant.Reply, error)
}

type ErrorWriter interface {
	HandleError(w http.ResponseWriter, r *http.Request, statusCode int, err error)
}

type Deps struct {
	Providers Providers
	Personas  Personas
	Agent     Answerer
	Errors    ErrorWriter
	// NewModel builds a model for a provider; tests replace it.
	NewModel func(*assistant.Provider, *assistant.Credential) (assistant.Model, error)
	Now      func() time.Time
}

type Handler struct {
	providers Providers
	personas  Personas
	agent     Answerer
	errors    ErrorWriter
	newModel  func(*assistant.Provider, *assistant.Credential) (assistant.Model, error)
	now       func() time.Time
	limiter   *limiter
}

func NewHandler(deps *Deps) *Handler {
	newModel := deps.NewModel
	if newModel == nil {
		newModel = func(p *assistant.Provider, c *assistant.Credential) (assistant.Model, error) {
			return assistant.NewModel(p, c, nil)
		}
	}
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	return &Handler{providers: deps.Providers, personas: deps.Personas, agent: deps.Agent, errors: deps.Errors,
		newModel: newModel, now: now, limiter: &limiter{window: messageWindow, max: messagesPerUser, seen: map[uuid.UUID][]time.Time{}}}
}

// Register mounts the routes. authenticate must accept a person's sign-in only.
func (h *Handler) Register(router chi.Router, authenticate func(http.Handler) http.Handler) {
	router.Group(func(r chi.Router) {
		r.Use(authenticate)
		r.Get(Prefix+"/assistant", h.status)
		r.Post(Prefix+"/messages", h.message)
		r.Get(Prefix+"/providers", h.admin(h.listProviders))
		r.Post(Prefix+"/providers", h.admin(h.createProvider))
		r.Patch(Prefix+"/providers/{providerId}", h.admin(h.updateProvider))
		r.Delete(Prefix+"/providers/{providerId}", h.admin(h.removeProvider))
		r.Post(Prefix+"/providers/{providerId}/test", h.admin(h.testProvider))
		r.Get(Prefix+"/personas", h.admin(h.listPersonas))
		r.Post(Prefix+"/personas", h.admin(h.createPersona))
		r.Patch(Prefix+"/personas/{slug}", h.admin(h.updatePersona))
		r.Delete(Prefix+"/personas/{slug}", h.admin(h.removePersona))
		r.Post(Prefix+"/personas/{slug}/reset", h.admin(h.resetPersona))
	})
}

func person(r *http.Request) (*auth.Identity, error) {
	identity, err := auth.IdentityFromContext(r.Context())
	if err != nil || identity == nil || identity.Actor != auth.ActorTypeUser || identity.AuthMode != auth.AuthModeJWT {
		return nil, errutil.Unauthorized("Sign in to use the Vaultix assistant.")
	}
	return identity, nil
}

// admin admits only instance administrators. Anyone else gets the same answer
// as for a missing route, so the configuration is not probeable.
func (h *Handler) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, err := person(r)
		if err != nil {
			h.errors.HandleError(w, r, http.StatusUnauthorized, err)
			return
		}
		if !identity.IsSuperAdmin {
			h.errors.HandleError(w, r, http.StatusNotFound, errutil.NotFound("This page is for instance administrators."))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), adminTimeout)
		defer cancel()
		next(w, r.WithContext(ctx))
	}
}

func providerID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "providerId"))
	if err != nil {
		return uuid.Nil, errutil.BadRequest("Provider ID '%s' is not a valid ID.", chi.URLParam(r, "providerId"))
	}
	return id, nil
}

func decode(r *http.Request, limit int64, into any) error {
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return errutil.BadRequest("The request body could not be read.")
	}
	if int64(len(raw)) > limit {
		return errutil.BadRequest("The request body is too large.")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return errutil.BadRequest("The request body is not valid JSON for this action.")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (h *Handler) listProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := h.providers.List(r.Context())
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": providers, "kinds": assistant.Kinds})
}

func (h *Handler) createProvider(w http.ResponseWriter, r *http.Request) {
	var input assistant.ProviderInput
	if err := decode(r, maxAdminBody, &input); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	provider, err := h.providers.Create(r.Context(), &input)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"provider": provider})
}

func (h *Handler) updateProvider(w http.ResponseWriter, r *http.Request) {
	id, err := providerID(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	var input assistant.ProviderInput
	if err := decode(r, maxAdminBody, &input); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	provider, err := h.providers.Update(r.Context(), id, &input)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"provider": provider})
}

func (h *Handler) removeProvider(w http.ResponseWriter, r *http.Request) {
	id, err := providerID(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	provider, err := h.providers.Delete(r.Context(), id)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"provider": provider})
}

// testProvider makes one real call and records the outcome, which is the receipt
// the admin page shows. A failing provider is a result, not an API error.
func (h *Handler) testProvider(w http.ResponseWriter, r *http.Request) {
	id, err := providerID(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), testTimeout)
	defer cancel()
	provider, credential, err := h.providers.ProviderWithCredential(ctx, id)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusNotFound, err)
		return
	}
	started := h.now()
	passed, message := false, ""
	model, err := h.newModel(provider, credential)
	if err == nil {
		var answer *assistant.ChatResponse
		answer, err = model.Chat(ctx, &assistant.ChatRequest{System: "You are a connection test.", MaxTokens: 16,
			Turns: []assistant.Turn{{Role: "user", Text: testPrompt}}})
		if err == nil {
			passed, message = true, "The model answered."
			if strings.TrimSpace(answer.Text) == "" {
				message = "The model answered with no text."
			}
		}
	}
	if err != nil {
		message = failureMessage(err)
	}
	latency := h.now().Sub(started)
	recorded, err := h.providers.RecordTest(ctx, id, passed, message, h.now().UTC())
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	outcome := "failed"
	if passed {
		outcome = "passed"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"test":     map[string]any{"outcome": outcome, "message": message, "latencyMs": latency.Milliseconds(), "testedAt": recorded.LastTestedAt},
		"provider": recorded,
	})
}

func (h *Handler) listPersonas(w http.ResponseWriter, r *http.Request) {
	personas, err := h.personas.List(r.Context())
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"personas": personas, "domains": assistant.Domains, "roles": assistant.Roles, "tiers": assistant.Tiers})
}

func (h *Handler) createPersona(w http.ResponseWriter, r *http.Request) {
	var input assistant.PersonaInput
	if err := decode(r, maxAdminBody, &input); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	persona, err := h.personas.Create(r.Context(), &input)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"persona": persona})
}

func (h *Handler) updatePersona(w http.ResponseWriter, r *http.Request) {
	var input assistant.PersonaInput
	if err := decode(r, maxAdminBody, &input); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	persona, err := h.personas.Update(r.Context(), chi.URLParam(r, "slug"), &input)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"persona": persona})
}

func (h *Handler) removePersona(w http.ResponseWriter, r *http.Request) {
	persona, err := h.personas.Delete(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"persona": persona})
}

func (h *Handler) resetPersona(w http.ResponseWriter, r *http.Request) {
	persona, err := h.personas.Reset(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"persona": persona})
}

func failureMessage(err error) string {
	var providerErr *assistant.ProviderError
	if errors.As(err, &providerErr) {
		return providerErr.Message
	}
	return "The provider could not be used."
}

// models resolves each persona's model: its own provider, else the active one.
func (h *Handler) models(ctx context.Context, persona *assistant.Persona) (assistant.Model, *assistant.Provider, error) {
	var provider *assistant.Provider
	var credential *assistant.Credential
	var err error
	if persona.ProviderID != nil {
		provider, credential, err = h.providers.ProviderWithCredential(ctx, *persona.ProviderID)
	} else {
		provider, credential, err = h.providers.Active(ctx)
	}
	if err != nil {
		return nil, nil, err
	}
	if provider == nil {
		return nil, nil, errutil.BadRequest(unavailableModel)
	}
	model, err := h.newModel(provider, credential)
	if err != nil {
		return nil, nil, errutil.InternalServer("The AI provider is not usable.").WithErr(err)
	}
	return model, provider, nil
}

type personaSummary struct {
	Slug        string         `json:"slug"`
	Name        string         `json:"name"`
	Role        assistant.Role `json:"role"`
	Description string         `json:"description"`
	Domains     []string       `json:"domains"`
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	if _, err := person(r); err != nil {
		h.errors.HandleError(w, r, http.StatusUnauthorized, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), adminTimeout)
	defer cancel()
	provider, _, err := h.providers.Active(ctx)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	personas, err := h.personas.List(ctx)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	summaries := []personaSummary{}
	for _, p := range personas {
		if p.Enabled && p.Role != assistant.RoleGuard {
			summaries = append(summaries, personaSummary{Slug: p.Slug, Name: p.Name, Role: p.Role, Description: p.Description, Domains: p.Domains})
		}
	}
	status := map[string]any{"available": provider != nil, "personas": summaries}
	if provider != nil {
		status["provider"] = map[string]any{"kind": provider.Kind, "model": provider.Model, "name": provider.Name}
	} else {
		status["reason"] = unavailableModel
	}
	writeJSON(w, http.StatusOK, map[string]any{"assistant": status})
}

func (h *Handler) message(w http.ResponseWriter, r *http.Request) {
	identity, err := person(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusUnauthorized, err)
		return
	}
	bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || bearer == "" {
		h.errors.HandleError(w, r, http.StatusUnauthorized, errutil.Unauthorized("Sign in to use the Vaultix assistant."))
		return
	}
	var request assistant.MessageRequest
	if err := decode(r, maxMessageBody, &request); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	if err := assistant.ValidateRequest(&request); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	if !h.limiter.allow(identity.ActorID, h.now()) {
		w.Header().Set("Retry-After", "60")
		h.errors.HandleError(w, r, http.StatusTooManyRequests, errutil.RateLimit("You are sending messages too quickly. Wait a minute and try again."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), messageTimeout)
	defer cancel()
	personas, err := h.personas.List(ctx)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	reply, err := h.agent.Answer(ctx, personas, h.models, bearer, &request)
	if err != nil {
		var providerErr *assistant.ProviderError
		if errors.As(err, &providerErr) {
			// The shared writer masks every 5xx message. This one names the provider's
			// failure, which is safe to show and is what the person needs to know.
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"reqId": requestid.FromContext(r.Context()), "statusCode": http.StatusBadGateway, "error": "BadGateway",
				"message": "The AI provider could not answer. " + providerErr.Message,
			})
			return
		}
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"message":  assistant.Message{Role: "assistant", Content: reply.Text},
		"actions":  reply.Actions,
		"persona":  reply.Persona,
		"routedBy": reply.RoutedBy,
		"provider": map[string]any{"kind": reply.Provider.Kind, "model": reply.Provider.Model, "name": reply.Provider.Name},
	})
}

// limiter is a per-person sliding window. It is per process; the standalone
// image runs one, and a fleet would move this to the shared rate limiter.
type limiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	seen   map[uuid.UUID][]time.Time
}

func (l *limiter) allow(actor uuid.UUID, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	recent := l.seen[actor][:0]
	for _, at := range l.seen[actor] {
		if now.Sub(at) < l.window {
			recent = append(recent, at)
		}
	}
	if len(recent) >= l.max {
		l.seen[actor] = recent
		return false
	}
	l.seen[actor] = append(recent, now)
	if len(l.seen) > 10000 {
		for id, times := range l.seen {
			if len(times) == 0 || now.Sub(times[len(times)-1]) >= l.window {
				delete(l.seen, id)
			}
		}
	}
	return true
}
