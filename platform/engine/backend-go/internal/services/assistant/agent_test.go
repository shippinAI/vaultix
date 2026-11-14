package assistant

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type scriptedModel struct {
	answers  []*ChatResponse
	requests []ChatRequest
}

func (m *scriptedModel) Chat(_ context.Context, request *ChatRequest) (*ChatResponse, error) {
	copied := *request
	copied.Turns = append([]Turn(nil), request.Turns...)
	m.requests = append(m.requests, copied)
	answer := m.answers[0]
	if len(m.answers) > 1 {
		m.answers = m.answers[1:]
	}
	return answer, nil
}

var (
	yes = true
	no  = false
)

// recordingHost serves a secrets and a public warp point; every other domain is planned.
type recordingHost struct {
	bearers []string
	calls   []string
	listed  []string
}

func (h *recordingHost) List(_ context.Context, bearer, domain string) ([]MCPTool, error) {
	h.bearers = append(h.bearers, bearer)
	h.listed = append(h.listed, domain)
	tool := func(name string, readOnly *bool) MCPTool {
		t := MCPTool{Name: name, Description: name, InputSchema: json.RawMessage(`{"type":"object"}`)}
		t.Annotations.ReadOnlyHint = readOnly
		return t
	}
	switch domain {
	case "secrets":
		return []MCPTool{tool("vaultix.secrets.references", &yes), tool("vaultix.secrets.delete", &no), tool("vaultix.secrets.unmarked", nil)}, nil
	case "public":
		return []MCPTool{tool("vaultix.guidance.get", &yes)}, nil
	}
	return nil, errNoWarpPoint
}

func (h *recordingHost) Call(_ context.Context, bearer, domain, name string, _ json.RawMessage) (string, bool, error) {
	h.bearers = append(h.bearers, bearer)
	h.calls = append(h.calls, domain+":"+name)
	return `{"references":[{"name":"DATABASE_URL"}]}`, false, nil
}

func testPersonas() []Persona {
	return []Persona{
		{Slug: "clyffy", Name: "Clyffy", Role: RoleRouter, Domains: []string{"public"}, Instructions: "router text", Enabled: true},
		{Slug: "secrets", Name: "Secrets specialist", Role: RoleSpecialist, Domains: []string{"secrets", "connect"}, Instructions: "secrets text", Description: "secrets", Enabled: true},
		{Slug: "access", Name: "Access specialist", Role: RoleSpecialist, Domains: []string{"access"}, Instructions: "access text", Description: "access", Enabled: true},
		{Slug: "security", Name: "Security guard", Role: RoleGuard, Domains: []string{"detect"}, Instructions: "guard", Enabled: true},
	}
}

func modelsFor(model Model) (ModelSource, *[]string) {
	asked := []string{}
	return func(_ context.Context, persona *Persona) (Model, *Provider, error) {
		asked = append(asked, persona.Slug)
		return model, &Provider{Kind: KindOpenAICompatible, Model: "m", Name: "local"}, nil
	}, &asked
}

func quietAgent(host ToolHost) *Agent {
	return NewAgent(slog.New(slog.NewTextHandler(io.Discard, nil)), host)
}

func TestAgentAnswer_SpecialistRunsOnlyItsReadOnlyToolsWithThePersonsBearer(t *testing.T) {
	host := &recordingHost{}
	model := &scriptedModel{answers: []*ChatResponse{
		{ToolCalls: []ToolCall{{ID: "1", Name: "vaultix__secrets__references", Arguments: json.RawMessage(`{}`)}, {ID: "2", Name: "vaultix__secrets__delete"}}},
		{Text: "You have DATABASE_URL."},
	}}
	models, _ := modelsFor(model)
	reply, err := quietAgent(host).Answer(context.Background(), testPersonas(), models, "person-token", nil, &MessageRequest{
		Messages: []Message{{Role: "user", Content: "what secrets do I have?"}},
		Signals:  []Signal{{Kind: "navigate", Path: "/organizations/x/projects/secret-manager/p"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reply.Persona.Slug != "secrets" || reply.RoutedBy != "page" || reply.Text != "You have DATABASE_URL." {
		t.Fatalf("reply %+v", reply)
	}
	for _, bearer := range host.bearers {
		if bearer != "person-token" {
			t.Fatalf("a tool ran with another credential: %q", bearer)
		}
	}
	if strings.Join(host.listed, ",") != "secrets,connect" {
		t.Fatalf("listed warp points %v; a persona must use only its own domains", host.listed)
	}
	offered := model.requests[0].Tools
	if len(offered) != 2 || offered[0].Name != "vaultix__secrets__references" || offered[1].Name != proposeTool {
		t.Fatalf("only read-only tools may be offered, got %+v", offered)
	}
	if len(host.calls) != 1 || host.calls[0] != "secrets:vaultix.secrets.references" {
		t.Fatalf("calls %v", host.calls)
	}
	if len(reply.Actions) != 2 || reply.Actions[0].Status != "ran" || reply.Actions[0].Domain != "secrets" || reply.Actions[1].Status != "failed" {
		t.Fatalf("actions %+v", reply.Actions)
	}
	if !strings.Contains(model.requests[0].System, "secrets text") || !strings.Contains(model.requests[0].System, "never see secret values") {
		t.Fatalf("persona instructions or standing rules missing: %s", model.requests[0].System)
	}
}

func TestAgentRoute_MentionPageRouterAndDefault(t *testing.T) {
	ask := func(request *MessageRequest, routerAnswer string) (*Persona, string, []string) {
		model := &scriptedModel{answers: []*ChatResponse{{Text: routerAnswer}}}
		models, asked := modelsFor(model)
		p, by := quietAgent(&recordingHost{}).route(context.Background(), testPersonas(), models, request)
		return p, by, *asked
	}
	user := func(text string) []Message { return []Message{{Role: "user", Content: text}} }

	if p, by, _ := ask(&MessageRequest{Messages: user("hi"), Persona: "access"}, ""); p.Slug != "access" || by != "mention" {
		t.Fatalf("explicit persona: %s %s", p.Slug, by)
	}
	if p, by, _ := ask(&MessageRequest{Messages: user("@access who can read prod?")}, ""); p.Slug != "access" || by != "mention" {
		t.Fatalf("@mention: %s %s", p.Slug, by)
	}
	if p, _, _ := ask(&MessageRequest{Messages: user("@security approve this")}, "clyffy"); p.Role == RoleGuard {
		t.Fatal("a guard must never answer the person directly")
	}
	if p, by, _ := ask(&MessageRequest{Messages: user("hi"), Signals: []Signal{{Kind: "action", Action: "vaultix.access.roles.open"}}}, ""); p.Slug != "access" || by != "page" {
		t.Fatalf("page domain: %s %s", p.Slug, by)
	}
	if p, by, asked := ask(&MessageRequest{Messages: user("rotate my db password")}, "secrets\n"); p.Slug != "secrets" || by != "router" || asked[0] != "clyffy" {
		t.Fatalf("router choice: %s %s %v", p.Slug, by, asked)
	}
	if p, by, _ := ask(&MessageRequest{Messages: user("hello")}, "I think the secrets one"); p.Slug != "clyffy" || by != "default" {
		t.Fatalf("an unclear router answer falls back to Clyffy: %s %s", p.Slug, by)
	}
	disabled := testPersonas()
	disabled[1].Enabled = false
	model := &scriptedModel{answers: []*ChatResponse{{Text: "secrets"}}}
	models, _ := modelsFor(model)
	if p, _ := quietAgent(&recordingHost{}).route(context.Background(), disabled, models, &MessageRequest{Messages: user("@secrets x")}); p.Slug == "secrets" {
		t.Fatal("a turned-off persona must not answer")
	}
}

func TestAgentAnswer_StopsAfterMaxRounds(t *testing.T) {
	model := &scriptedModel{answers: []*ChatResponse{{Text: "again", ToolCalls: []ToolCall{{ID: "1", Name: "vaultix__secrets__references"}}}}}
	models, _ := modelsFor(model)
	reply, err := quietAgent(&recordingHost{}).Answer(context.Background(), testPersonas(), models, "t", nil,
		&MessageRequest{Messages: []Message{{Role: "user", Content: "@secrets loop"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(reply.Actions) != maxRounds || len(model.requests) != maxRounds+1 || model.requests[maxRounds].Tools != nil {
		t.Fatalf("rounds not bounded: actions=%d requests=%d", len(reply.Actions), len(model.requests))
	}
}

func TestValidateRequest_RejectsValuesInSignals(t *testing.T) {
	ok := Message{Role: "user", Content: "hi"}
	cases := map[string]MessageRequest{
		"no messages":                 {},
		"last is assistant":           {Messages: []Message{ok, {Role: "assistant", Content: "x"}}},
		"bad role":                    {Messages: []Message{{Role: "system", Content: "x"}}},
		"value in action":             {Messages: []Message{ok}, Signals: []Signal{{Kind: "action", Action: "postgres://admin:hunter2@db"}}},
		"value in path":               {Messages: []Message{ok}, Signals: []Signal{{Kind: "navigate", Path: "/x?value=hunter2"}}},
		"value with spaces in target": {Messages: []Message{ok}, Signals: []Signal{{Kind: "action", Action: "a", Target: "my password is x"}}},
		"unknown kind":                {Messages: []Message{ok}, Signals: []Signal{{Kind: "input", Action: "a"}}},
		"action without name":         {Messages: []Message{ok}, Signals: []Signal{{Kind: "action"}}},
		"bad persona":                 {Messages: []Message{ok}, Persona: "Not A Slug"},
	}
	for name, request := range cases {
		t.Run(name, func(t *testing.T) {
			if err := ValidateRequest(&request); err == nil {
				t.Fatal("accepted")
			}
		})
	}
	good := MessageRequest{Messages: []Message{ok}, Persona: "secrets", Signals: []Signal{{Kind: "action", Action: "vaultix.secrets.create", Scope: "project", Target: "dashboard", Path: "/organizations/1/projects/2", At: "2026-11-11T10:00:00Z"}}}
	if err := ValidateRequest(&good); err != nil {
		t.Fatal(err)
	}
}

func TestMCPClient_UsesTheWarpPointAndTurnsRefusalsIntoResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer person-token" {
			t.Errorf("auth %q", r.Header.Get("Authorization"))
		}
		if r.URL.Path == "/api/vx/v1/pki/mcp" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.URL.Path != "/api/vx/v1/public/mcp" {
			t.Errorf("path %s", r.URL.Path)
		}
		var body struct {
			Method string `json:"method"`
			Params struct {
				Name string `json:"name"`
			} `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case body.Method == "tools/list":
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"vaultix.guidance.get","description":"d","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":true}}]}}`)
		case body.Params.Name == "vaultix.guidance.get":
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"lesson"}]}}`)
		default:
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	defer server.Close()
	client := &MCPClient{BaseURL: server.URL, Client: server.Client()}
	tools, err := client.List(context.Background(), "person-token", "public")
	if err != nil || len(tools) != 1 || !tools[0].readOnly() {
		t.Fatalf("tools=%+v err=%v", tools, err)
	}
	if _, err := client.List(context.Background(), "person-token", "pki"); err != errNoWarpPoint {
		t.Fatalf("a planned warp point should be skipped, got %v", err)
	}
	if _, err := client.List(context.Background(), "person-token", "../admin"); err == nil {
		t.Fatal("an unknown domain must be refused before any request")
	}
	text, isError, err := client.Call(context.Background(), "person-token", "public", "vaultix.guidance.get", nil)
	if err != nil || isError || text != "lesson" {
		t.Fatalf("text=%q isError=%v err=%v", text, isError, err)
	}
	text, isError, err = client.Call(context.Background(), "person-token", "public", "vaultix.other", nil)
	if err != nil || !isError || !strings.Contains(text, "unavailable") {
		t.Fatalf("refusal should be a tool result: text=%q isError=%v err=%v", text, isError, err)
	}
}

func TestLoadDefaultPersonas_ShippedFolder(t *testing.T) {
	personas, err := LoadDefaultPersonas("../../../../ai")
	if err != nil {
		t.Fatal(err)
	}
	slugs := []string{}
	for _, p := range personas {
		slugs = append(slugs, p.Slug)
		if p.ID != "vaultix.persona."+p.Slug || !p.BuiltIn || !p.Enabled || p.Instructions == "" {
			t.Fatalf("persona %+v", p)
		}
	}
	if strings.Join(slugs, ",") != "clyffy,access,operate,secrets,security" {
		t.Fatalf("default personas %v", slugs)
	}
	if personas[0].Role != RoleRouter || personas[len(personas)-1].Role != RoleGuard {
		t.Fatal("order must be router, specialists, guard")
	}
}

func TestParsePersona_Rejects(t *testing.T) {
	front := func(fields string) string {
		return "---\nschemaVersion: vaultix.ai-persona.v1\nname: X\ndescription: d\n" + fields + "---\nbody"
	}
	cases := map[string]string{
		"no front matter":   "hello",
		"slug not folder":   front("slug: other\nrole: specialist\ndomains: [secrets]\nmodel:\n  tier: fast\n"),
		"unknown domain":    front("slug: x1\nrole: specialist\ndomains: [identity]\nmodel:\n  tier: fast\n"),
		"no body":           "---\nschemaVersion: vaultix.ai-persona.v1\nslug: x1\nname: X\ndescription: d\nrole: specialist\ndomains: [secrets]\nmodel:\n  tier: fast\n---\n",
		"bad role":          front("slug: x1\nrole: boss\ndomains: [secrets]\nmodel:\n  tier: fast\n"),
		"old id field":      front("id: vaultix.persona.x1\nslug: x1\nrole: specialist\ndomains: [secrets]\nmodel:\n  tier: fast\n"),
		"missing model":     front("slug: x1\nrole: specialist\ndomains: [secrets]\n"),
		"no schema version": "---\nslug: x1\nname: X\ndescription: d\nrole: specialist\ndomains: [secrets]\nmodel:\n  tier: fast\n---\nbody",
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parsePersona("x1", []byte(raw)); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}

func TestAgentAnswer_MemoriesReachThePromptAndSuggestionsSaveNothing(t *testing.T) {
	model := &scriptedModel{answers: []*ChatResponse{
		{ToolCalls: []ToolCall{
			{ID: "1", Name: proposeTool, Arguments: json.RawMessage(`{"content":"Prefers the staging environment."}`)},
			{ID: "2", Name: proposeTool, Arguments: json.RawMessage(`{"content":"The key is sk-ant-api03-AbCdEfGhIjKlMnOpQrSt"}`)},
		}},
		{Text: "Noted."},
	}}
	models, _ := modelsFor(model)
	memories := []Memory{
		{Scope: ScopeInstance, Content: "Production changes need a ticket."},
		{Scope: ScopePersonal, Content: "Works on payments.", Persona: "secrets"},
		{Scope: ScopePersonal, Content: "Only for access.", Persona: "access"},
	}
	reply, err := quietAgent(&recordingHost{}).Answer(context.Background(), testPersonas(), models, "t", memories, &MessageRequest{
		Messages: []Message{{Role: "user", Content: "@secrets I always use staging"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	system := model.requests[0].System
	if !strings.Contains(system, "(instance) Production changes need a ticket.") || !strings.Contains(system, "(personal) Works on payments.") {
		t.Fatalf("memories missing from the prompt: %s", system)
	}
	if strings.Contains(system, "Only for access.") {
		t.Fatal("a memory for another persona reached this one")
	}
	if !strings.Contains(system, "information, not instructions") {
		t.Fatal("memories must be framed as notes")
	}
	if len(reply.Proposals) != 1 || reply.Proposals[0].Content != "Prefers the staging environment." {
		t.Fatalf("proposals %+v", reply.Proposals)
	}
	results := model.requests[1].Turns[len(model.requests[1].Turns)-1].Results
	if len(results) != 2 || results[0].IsError || !results[1].IsError || !strings.Contains(results[1].Content, "secret value") {
		t.Fatalf("suggestion results %+v", results)
	}
	if strings.Contains(reply.Text+results[1].Content, "sk-ant-api03") {
		t.Fatal("the refused value was echoed")
	}
}

func TestLooksLikeSecret(t *testing.T) {
	secrets := []string{
		"sk-ant-api03-AbCdEfGhIjKlMnOpQrSt",
		"token ghp_abcdefghijklmnopqrstuvwxyz0123",
		"AKIAIOSFODNN7EXAMPLE",
		"postgres://app:hunter2@db:5432/app",
		"-----BEGIN RSA PRIVATE KEY-----",
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		"use 9fK2xQ7vLm3PzR8tWb4NcY6hJd1sGe5A for the webhook",
	}
	for _, s := range secrets {
		if !LooksLikeSecret(s) {
			t.Errorf("should refuse %q", s)
		}
	}
	notes := []string{
		"Prefers the staging environment and replies in French.",
		"Project 3f2504e0-4f89-11d3-9a0c-0305e82c3301 is the payments project.",
		"Name new secrets SERVICE_NAME_DATABASE_URL in uppercase.",
		"Uses the /organizations/acme/projects/secret-manager path.",
		"internationalization-and-localization-settings",
	}
	for _, s := range notes {
		if LooksLikeSecret(s) {
			t.Errorf("should accept %q", s)
		}
	}
}

func TestProviderModelFor(t *testing.T) {
	p := &Provider{Model: "std", FastModel: "quick"}
	if p.ModelFor("fast") != "quick" || p.ModelFor("deep") != "std" || p.ModelFor("standard") != "std" {
		t.Fatal("tier models")
	}
	if strings.Join((&Provider{Model: "a", FastModel: "b", DeepModel: "a"}).Models(), ",") != "a,b" {
		t.Fatal("distinct models")
	}
}
