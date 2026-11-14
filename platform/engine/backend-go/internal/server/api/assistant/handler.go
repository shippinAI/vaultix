// Package assistant serves the in-app assistant at /api/vx/v1/ai (docs/0123,
// docs/0124): AI providers and personas managed by instance administrators, and
// chat for any signed-in person.
package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/vaultix-cloud/api/internal/services/assistant/spec"
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

// Memories is the memory store.
type Memories interface {
	List(ctx context.Context, userID uuid.UUID) ([]assistant.Memory, error)
	Create(ctx context.Context, userID uuid.UUID, admin bool, input *assistant.MemoryInput) (*assistant.Memory, error)
	Update(ctx context.Context, userID uuid.UUID, admin bool, id uuid.UUID, input *assistant.MemoryInput) (*assistant.Memory, error)
	Delete(ctx context.Context, userID uuid.UUID, admin bool, id uuid.UUID) (*assistant.Memory, error)
}

// Answerer routes and answers one chat turn.
type Answerer interface {
	Answer(ctx context.Context, personas []assistant.Persona, models assistant.ModelSource, bearer string, memories []assistant.Memory, request *assistant.MessageRequest) (*assistant.Reply, error)
}

type ErrorWriter interface {
	HandleError(w http.ResponseWriter, r *http.Request, statusCode int, err error)
}

type Deps struct {
	Providers Providers
	Personas  Personas
	Memories  Memories
	Agent     Answerer
	Errors    ErrorWriter
	// NewModel and ListModels reach a provider; tests replace them.
	NewModel   func(*assistant.Provider, *assistant.Credential) (assistant.Model, error)
	ListModels func(context.Context, *assistant.Provider, *assistant.Credential) ([]assistant.ModelInfo, error)
	Now        func() time.Time
}

type Handler struct {
	providers  Providers
	personas   Personas
	memories   Memories
	agent      Answerer
	errors     ErrorWriter
	newModel   func(*assistant.Provider, *assistant.Credential) (assistant.Model, error)
	listModels func(context.Context, *assistant.Provider, *assistant.Credential) ([]assistant.ModelInfo, error)
	now        func() time.Time
	limiter    *limiter
}

func NewHandler(deps *Deps) *Handler {
	newModel := deps.NewModel
	if newModel == nil {
		newModel = func(p *assistant.Provider, c *assistant.Credential) (assistant.Model, error) {
			return assistant.NewModel(p, c, nil)
		}
	}
	listModels := deps.ListModels
	if listModels == nil {
		listModels = func(ctx context.Context, p *assistant.Provider, c *assistant.Credential) ([]assistant.ModelInfo, error) {
			return assistant.ListModels(ctx, p, c, nil)
		}
	}
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	return &Handler{providers: deps.Providers, personas: deps.Personas, memories: deps.Memories, agent: deps.Agent, errors: deps.Errors,
		newModel: newModel, listModels: listModels, now: now, limiter: &limiter{window: messageWindow, max: messagesPerUser, seen: map[uuid.UUID][]time.Time{}}}
}

// Register mounts the routes. authenticate must accept a person's sign-in only.
func (h *Handler) Register(router chi.Router, authenticate func(http.Handler) http.Handler) {
	router.Group(func(r chi.Router) {
		r.Use(authenticate)
		r.Get(Prefix+"/assistant", h.status)
		r.Get(Prefix+"/schema", h.signedIn(h.schema))
		r.Post(Prefix+"/messages", h.message)
		r.Get(Prefix+"/memories", h.signedIn(h.listMemories))
		r.Post(Prefix+"/memories", h.signedIn(h.createMemory))
		r.Patch(Prefix+"/memories/{memoryId}", h.signedIn(h.updateMemory))
		r.Delete(Prefix+"/memories/{memoryId}", h.signedIn(h.removeMemory))
		r.Get(Prefix+"/providers", h.admin(h.listProviders))
		r.Post(Prefix+"/providers", h.admin(h.createProvider))
		r.Patch(Prefix+"/providers/{providerId}", h.admin(h.updateProvider))
		r.Delete(Prefix+"/providers/{providerId}", h.admin(h.removeProvider))
		r.Post(Prefix+"/providers/{providerId}/test", h.admin(h.testProvider))
		r.Get(Prefix+"/providers/{providerId}/models", h.admin(h.providerModels))
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

// signedIn admits any person signed in to Vaultix and bounds the request.
func (h *Handler) signedIn(next func(http.ResponseWriter, *http.Request, *auth.Identity)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, err := person(r)
		if err != nil {
			h.errors.HandleError(w, r, http.StatusUnauthorized, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), adminTimeout)
		defer cancel()
		next(w, r.WithContext(ctx), identity)
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
	passed, message := h.testModels(ctx, provider, credential)
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

// testModels asks every model the provider is configured with for one word.
// The first failure names its model; a pass covers them all.
func (h *Handler) testModels(ctx context.Context, provider *assistant.Provider, credential *assistant.Credential) (bool, string) {
	models := provider.Models()
	empty := 0
	for _, id := range models {
		configured := *provider
		configured.Model = id
		model, err := h.newModel(&configured, credential)
		if err == nil {
			var answer *assistant.ChatResponse
			answer, err = model.Chat(ctx, &assistant.ChatRequest{System: "You are a connection test.", MaxTokens: 16,
				Turns: []assistant.Turn{{Role: "user", Text: testPrompt}}})
			if err == nil && strings.TrimSpace(answer.Text) == "" {
				empty++
			}
		}
		if err != nil {
			if len(models) == 1 {
				return false, failureMessage(err)
			}
			return false, id + ": " + failureMessage(err)
		}
	}
	message := "The model answered."
	if len(models) > 1 {
		message = fmt.Sprintf("All %d models answered.", len(models))
	}
	if empty > 0 {
		message += fmt.Sprintf(" %d answered with no text.", empty)
	}
	return true, message
}

// providerModels asks the provider which models its credential can use. A
// provider that will not list them is a result the page shows, not an error.
func (h *Handler) providerModels(w http.ResponseWriter, r *http.Request) {
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
	models, err := h.listModels(ctx, provider, credential)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []assistant.ModelInfo{}, "listed": false,
			"message": "The provider did not list its models. " + failureMessage(err) + " You can still type any model ID it accepts."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models, "listed": true, "message": ""})
}

// schema returns the v1 connection and persona schemas the UI builds its forms from (docs/0126).
func (h *Handler) schema(w http.ResponseWriter, _ *http.Request, _ *auth.Identity) {
	body := map[string]json.RawMessage{}
	for key, file := range map[string]string{"connection": "vaultix.ai-connection.v1.schema.json", "persona": "vaultix.ai-persona.v1.schema.json"} {
		raw, err := spec.Schemas.ReadFile("schema/" + file)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The AI schema is missing from this build."})
			return
		}
		body[key] = raw
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemas": body})
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
	configured := *provider
	configured.Model = persona.Model
	if configured.Model == "" {
		configured.Model = provider.ModelFor(persona.Tier)
	}
	model, err := h.newModel(&configured, credential)
	if err != nil {
		return nil, nil, errutil.InternalServer("The AI provider is not usable.").WithErr(err)
	}
	return model, &configured, nil
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
	memories, err := h.memories.List(ctx, identity.ActorID)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	reply, err := h.agent.Answer(ctx, personas, h.models, bearer, memories, &request)
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
		"message":   assistant.Message{Role: "assistant", Content: reply.Text},
		"actions":   reply.Actions,
		"proposals": reply.Proposals,
		"persona":   reply.Persona,
		"routedBy":  reply.RoutedBy,
		"provider":  map[string]any{"kind": reply.Provider.Kind, "model": reply.Provider.Model, "name": reply.Provider.Name},
	})
}

func memoryID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "memoryId"))
	if err != nil {
		return uuid.Nil, errutil.BadRequest("Memory ID '%s' is not a valid ID.", chi.URLParam(r, "memoryId"))
	}
	return id, nil
}

func (h *Handler) listMemories(w http.ResponseWriter, r *http.Request, identity *auth.Identity) {
	memories, err := h.memories.List(r.Context(), identity.ActorID)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": memories, "canManageInstance": identity.IsSuperAdmin})
}

func (h *Handler) createMemory(w http.ResponseWriter, r *http.Request, identity *auth.Identity) {
	var input assistant.MemoryInput
	if err := decode(r, maxAdminBody, &input); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	memory, err := h.memories.Create(r.Context(), identity.ActorID, identity.IsSuperAdmin, &input)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"memory": memory})
}

func (h *Handler) updateMemory(w http.ResponseWriter, r *http.Request, identity *auth.Identity) {
	id, err := memoryID(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	var input assistant.MemoryInput
	if err := decode(r, maxAdminBody, &input); err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	memory, err := h.memories.Update(r.Context(), identity.ActorID, identity.IsSuperAdmin, id, &input)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memory": memory})
}

func (h *Handler) removeMemory(w http.ResponseWriter, r *http.Request, identity *auth.Identity) {
	id, err := memoryID(r)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	memory, err := h.memories.Delete(r.Context(), identity.ActorID, identity.IsSuperAdmin, id)
	if err != nil {
		h.errors.HandleError(w, r, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memory": memory})
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
