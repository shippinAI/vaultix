package assistant

import (
	"context"
	"encoding/json"
	"fmt"
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
	"github.com/vaultix-cloud/api/internal/server/api/shared"
	"github.com/vaultix-cloud/api/internal/services/assistant"
	"github.com/vaultix-cloud/api/internal/services/auth"
)

type fakeProviders struct {
	active   *assistant.Provider
	stored   *assistant.Provider
	recorded []string
}

func (f *fakeProviders) List(context.Context) ([]assistant.Provider, error) {
	return []assistant.Provider{}, nil
}
func (f *fakeProviders) Active(context.Context) (*assistant.Provider, *assistant.Credential, error) {
	return f.active, &assistant.Credential{APIKey: "sk-canary"}, nil
}
func (f *fakeProviders) ProviderWithCredential(_ context.Context, id uuid.UUID) (*assistant.Provider, *assistant.Credential, error) {
	if f.stored != nil {
		return f.stored, &assistant.Credential{APIKey: "sk-canary"}, nil
	}
	return &assistant.Provider{ID: id, Kind: assistant.KindOpenAI, Model: "m"}, &assistant.Credential{APIKey: "sk-canary"}, nil
}
func (f *fakeProviders) Create(context.Context, *assistant.ProviderInput) (*assistant.Provider, error) {
	return &assistant.Provider{}, nil
}
func (f *fakeProviders) Update(context.Context, uuid.UUID, *assistant.ProviderInput) (*assistant.Provider, error) {
	return &assistant.Provider{}, nil
}
func (f *fakeProviders) Delete(context.Context, uuid.UUID) (*assistant.Provider, error) {
	return &assistant.Provider{}, nil
}
func (f *fakeProviders) RecordTest(_ context.Context, id uuid.UUID, passed bool, message string, at time.Time) (*assistant.Provider, error) {
	f.recorded = append(f.recorded, message)
	return &assistant.Provider{ID: id, LastTestedAt: &at}, nil
}

type fakePersonas struct{}

func (fakePersonas) List(context.Context) ([]assistant.Persona, error) {
	return []assistant.Persona{{Slug: "clyffy", Name: "Clyffy", Role: assistant.RoleRouter, Domains: []string{"public"}, Instructions: "x", Enabled: true}}, nil
}
func (fakePersonas) Create(context.Context, *assistant.PersonaInput) (*assistant.Persona, error) {
	return &assistant.Persona{}, nil
}
func (fakePersonas) Update(context.Context, string, *assistant.PersonaInput) (*assistant.Persona, error) {
	return &assistant.Persona{}, nil
}
func (fakePersonas) Reset(context.Context, string) (*assistant.Persona, error) {
	return &assistant.Persona{}, nil
}
func (fakePersonas) Delete(context.Context, string) (*assistant.Persona, error) {
	return &assistant.Persona{}, nil
}

type fakeMemories struct {
	calls []string
}

func (f *fakeMemories) List(context.Context, uuid.UUID) ([]assistant.Memory, error) {
	return []assistant.Memory{{Scope: assistant.ScopePersonal, Content: "Works in the payments project."}}, nil
}
func (f *fakeMemories) Create(_ context.Context, _ uuid.UUID, admin bool, input *assistant.MemoryInput) (*assistant.Memory, error) {
	f.calls = append(f.calls, fmt.Sprintf("create admin=%t", admin))
	if input.Scope != nil && *input.Scope == assistant.ScopeInstance && !admin {
		return nil, errutil.Forbidden("Only instance administrators can add memories for everyone.")
	}
	return &assistant.Memory{ID: uuid.New()}, nil
}
func (f *fakeMemories) Update(_ context.Context, _ uuid.UUID, admin bool, _ uuid.UUID, _ *assistant.MemoryInput) (*assistant.Memory, error) {
	f.calls = append(f.calls, fmt.Sprintf("update admin=%t", admin))
	return &assistant.Memory{}, nil
}
func (f *fakeMemories) Delete(_ context.Context, _ uuid.UUID, admin bool, _ uuid.UUID) (*assistant.Memory, error) {
	f.calls = append(f.calls, fmt.Sprintf("delete admin=%t", admin))
	return nil, errutil.NotFound("Memory was not found.")
}

type failingModel struct{}

func (failingModel) Chat(context.Context, *assistant.ChatRequest) (*assistant.ChatResponse, error) {
	return nil, &assistant.ProviderError{Status: 401, Message: "The provider refused the credential."}
}

type agentFunc func() (*assistant.Reply, error)

func (f agentFunc) Answer(ctx context.Context, _ []assistant.Persona, models assistant.ModelSource, _ string, _ []assistant.Memory, _ *assistant.MessageRequest) (*assistant.Reply, error) {
	if _, _, err := models(ctx, &assistant.Persona{Slug: "clyffy"}); err != nil {
		return nil, err
	}
	return f()
}

func serve(t *testing.T, providers *fakeProviders, agent Answerer, identity *auth.Identity, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	return serveWith(t, &Deps{Providers: providers, Personas: fakePersonas{}, Memories: &fakeMemories{}, Agent: agent,
		NewModel: func(*assistant.Provider, *assistant.Credential) (assistant.Model, error) { return failingModel{}, nil }},
		identity, method, path, body)
}

func serveWith(t *testing.T, deps *Deps, identity *auth.Identity, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	deps.Errors = shared.NewErrorHandler(slog.New(slog.NewTextHandler(io.Discard, nil)))
	h := NewHandler(deps)
	router := chi.NewRouter()
	h.Register(router, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if identity != nil {
				r = r.WithContext(auth.WithIdentity(r.Context(), identity))
			}
			next.ServeHTTP(w, r)
		})
	})
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer person-token")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func personIdentity(superAdmin bool) *auth.Identity {
	return &auth.Identity{Actor: auth.ActorTypeUser, AuthMode: auth.AuthModeJWT, ActorID: uuid.New(), OrgID: uuid.New(), IsSuperAdmin: superAdmin}
}

func TestAdminRoutes_OnlyInstanceAdministrators(t *testing.T) {
	for _, path := range []string{Prefix + "/providers", Prefix + "/personas"} {
		if code := serve(t, &fakeProviders{}, nil, personIdentity(false), http.MethodGet, path, "").Code; code != http.StatusNotFound {
			t.Fatalf("%s for a member: %d", path, code)
		}
		if code := serve(t, &fakeProviders{}, nil, nil, http.MethodGet, path, "").Code; code != http.StatusUnauthorized {
			t.Fatalf("%s signed out: %d", path, code)
		}
		if code := serve(t, &fakeProviders{}, nil, personIdentity(true), http.MethodGet, path, "").Code; code != http.StatusOK {
			t.Fatalf("%s for an administrator: %d", path, code)
		}
	}
	machine := &auth.Identity{Actor: auth.ActorTypeIdentity, AuthMode: auth.AuthModeIdentityAccessToken, ActorID: uuid.New(), IsSuperAdmin: true}
	if code := serve(t, &fakeProviders{}, nil, machine, http.MethodGet, Prefix+"/providers", "").Code; code != http.StatusUnauthorized {
		t.Fatalf("a machine identity must not manage providers: %d", code)
	}
}

func TestTestProvider_RecordsAFailureAsTheReceipt(t *testing.T) {
	providers := &fakeProviders{}
	recorder := serve(t, providers, nil, personIdentity(true), http.MethodPost, Prefix+"/providers/"+uuid.NewString()+"/test", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("code %d %s", recorder.Code, recorder.Body)
	}
	var body struct {
		Test struct {
			Outcome, Message string
		}
	}
	_ = json.Unmarshal(recorder.Body.Bytes(), &body)
	if body.Test.Outcome != "failed" || body.Test.Message != "The provider refused the credential." || len(providers.recorded) != 1 {
		t.Fatalf("test %+v recorded %v", body.Test, providers.recorded)
	}
	if strings.Contains(recorder.Body.String(), "sk-canary") {
		t.Fatal("the credential leaked into the answer")
	}
}

func TestMessage_NoProviderAndProviderFailure(t *testing.T) {
	never := agentFunc(func() (*assistant.Reply, error) { t.Fatal("must not answer"); return nil, nil })
	body := `{"messages":[{"role":"user","content":"hi"}]}`
	recorder := serve(t, &fakeProviders{}, never, personIdentity(false), http.MethodPost, Prefix+"/messages", body)
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "No AI provider is active") {
		t.Fatalf("no provider: %d %s", recorder.Code, recorder.Body)
	}
	failing := agentFunc(func() (*assistant.Reply, error) {
		return nil, &assistant.ProviderError{Status: 429, Message: "The provider is rate limiting this account."}
	})
	recorder = serve(t, &fakeProviders{active: &assistant.Provider{Kind: assistant.KindOpenAI, Model: "m"}}, failing, personIdentity(false), http.MethodPost, Prefix+"/messages", body)
	if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), "rate limiting this account") {
		t.Fatalf("provider failure must be shown: %d %s", recorder.Code, recorder.Body)
	}
	if code := serve(t, &fakeProviders{}, never, personIdentity(false), http.MethodPost, Prefix+"/messages", `{"messages":[],"extra":1}`).Code; code != http.StatusBadRequest {
		t.Fatalf("unknown fields must be refused: %d", code)
	}
}

func TestLimiter_SlidingWindow(t *testing.T) {
	l := &limiter{window: time.Minute, max: 2, seen: map[uuid.UUID][]time.Time{}}
	who, now := uuid.New(), time.Now()
	if !l.allow(who, now) || !l.allow(who, now) || l.allow(who, now) {
		t.Fatal("third message inside the window must be refused")
	}
	if !l.allow(who, now.Add(61*time.Second)) {
		t.Fatal("the window must slide")
	}
}

type answeringModel struct{}

func (m answeringModel) Chat(context.Context, *assistant.ChatRequest) (*assistant.ChatResponse, error) {
	return &assistant.ChatResponse{Text: "OK"}, nil
}

func TestModels_TierAndPersonaOverride(t *testing.T) {
	built := []string{}
	h := NewHandler(&Deps{
		Providers: &fakeProviders{active: &assistant.Provider{Kind: assistant.KindAnthropic, Model: "std", FastModel: "quick", DeepModel: "big"}},
		NewModel: func(p *assistant.Provider, _ *assistant.Credential) (assistant.Model, error) {
			built = append(built, p.Model)
			return answeringModel{}, nil
		},
	})
	for _, persona := range []assistant.Persona{{Tier: "fast"}, {Tier: "standard"}, {Tier: "deep"}, {Tier: "fast", Model: "pinned"}} {
		_, provider, err := h.models(context.Background(), &persona)
		if err != nil {
			t.Fatal(err)
		}
		if provider.Model != built[len(built)-1] {
			t.Fatalf("reply names %s, ran %s", provider.Model, built[len(built)-1])
		}
	}
	if strings.Join(built, ",") != "quick,std,big,pinned" {
		t.Fatalf("models %v", built)
	}
}

func TestTestProvider_TestsEveryConfiguredModel(t *testing.T) {
	built := []string{}
	providers := &fakeProviders{stored: &assistant.Provider{ID: uuid.New(), Kind: assistant.KindOpenAI, Model: "std", FastModel: "quick", DeepModel: "std"}}
	recorder := serveWith(t, &Deps{Providers: providers, Personas: fakePersonas{}, Memories: &fakeMemories{},
		NewModel: func(p *assistant.Provider, _ *assistant.Credential) (assistant.Model, error) {
			built = append(built, p.Model)
			if p.Model == "quick" {
				return failingModel{}, nil
			}
			return answeringModel{}, nil
		}}, personIdentity(true), http.MethodPost, Prefix+"/providers/"+uuid.NewString()+"/test", "")
	if recorder.Code != http.StatusOK || strings.Join(built, ",") != "std,quick" {
		t.Fatalf("code %d models %v", recorder.Code, built)
	}
	if len(providers.recorded) != 1 || providers.recorded[0] != "quick: The provider refused the credential." {
		t.Fatalf("receipt %v", providers.recorded)
	}
}

func TestProviderModels_ListedOrExplained(t *testing.T) {
	deps := &Deps{Providers: &fakeProviders{}, Personas: fakePersonas{}, Memories: &fakeMemories{},
		ListModels: func(context.Context, *assistant.Provider, *assistant.Credential) ([]assistant.ModelInfo, error) {
			return []assistant.ModelInfo{{ID: "gpt-x", Name: "gpt-x"}}, nil
		}}
	path := Prefix + "/providers/" + uuid.NewString() + "/models"
	recorder := serveWith(t, deps, personIdentity(true), http.MethodGet, path, "")
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"listed":true`) || !strings.Contains(recorder.Body.String(), "gpt-x") {
		t.Fatalf("listed: %d %s", recorder.Code, recorder.Body)
	}
	deps.ListModels = func(context.Context, *assistant.Provider, *assistant.Credential) ([]assistant.ModelInfo, error) {
		return nil, &assistant.ProviderError{Status: 403, Message: "The provider refused the credential."}
	}
	recorder = serveWith(t, deps, personIdentity(true), http.MethodGet, path, "")
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"listed":false`) || !strings.Contains(recorder.Body.String(), "refused the credential") {
		t.Fatalf("explained: %d %s", recorder.Code, recorder.Body)
	}
	if strings.Contains(recorder.Body.String(), "sk-canary") {
		t.Fatal("the credential leaked")
	}
	if code := serveWith(t, deps, personIdentity(false), http.MethodGet, path, "").Code; code != http.StatusNotFound {
		t.Fatalf("a member must not list models: %d", code)
	}
}

func TestMemories_EveryPersonOwnsTheirs(t *testing.T) {
	memories := &fakeMemories{}
	deps := &Deps{Providers: &fakeProviders{}, Personas: fakePersonas{}, Memories: memories}
	recorder := serveWith(t, deps, personIdentity(false), http.MethodGet, Prefix+"/memories", "")
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"canManageInstance":false`) {
		t.Fatalf("list: %d %s", recorder.Code, recorder.Body)
	}
	if code := serveWith(t, deps, personIdentity(false), http.MethodPost, Prefix+"/memories", `{"content":"x","scope":"instance"}`).Code; code != http.StatusForbidden {
		t.Fatalf("a member adding an instance memory: %d", code)
	}
	if code := serveWith(t, deps, personIdentity(true), http.MethodPost, Prefix+"/memories", `{"content":"x","scope":"instance"}`).Code; code != http.StatusCreated {
		t.Fatalf("an administrator adding an instance memory: %d", code)
	}
	if code := serveWith(t, deps, personIdentity(false), http.MethodDelete, Prefix+"/memories/"+uuid.NewString(), "").Code; code != http.StatusNotFound {
		t.Fatalf("deleting a memory that is not yours: %d", code)
	}
	if code := serveWith(t, deps, personIdentity(false), http.MethodPatch, Prefix+"/memories/not-an-id", `{}`).Code; code != http.StatusBadRequest {
		t.Fatalf("bad id: %d", code)
	}
	if code := serveWith(t, deps, nil, http.MethodGet, Prefix+"/memories", "").Code; code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", code)
	}
	if strings.Join(memories.calls, ";") != "create admin=false;create admin=true;delete admin=false" {
		t.Fatalf("calls %v", memories.calls)
	}
}
