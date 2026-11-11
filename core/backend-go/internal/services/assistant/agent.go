package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/vaultix-cloud/api/internal/libs/errutil"
)

const (
	maxMessages        = 40
	maxMessageLength   = 8000
	maxSignals         = 20
	maxRounds          = 6
	maxCallsPerRound   = 4
	maxToolResultChars = 12000
	answerTokens       = 1500
	routeTokens        = 16
	maxMCPBytes        = 1 << 20
)

// standingRules apply to every persona and come before its own instructions.
const standingRules = `Standing rules for every Vaultix assistant:
- You act only through the tools provided. They run with the signed-in person's own permissions; if a tool refuses, the person is not allowed to do that, so say so plainly and never suggest a way around it.
- You never see secret values and never ask for one. Talk about secrets by name, environment and path. If the person pastes something that looks like a secret value, tell them to store it in Vaultix instead, and do not repeat it.
- Be brief and concrete. When you point somewhere, name the Vaultix page or action.`

// Message is one visible chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Signal is a value-free record of something the person did in the app
// (docs/0123). It names a catalog action or a page, never an input's value.
type Signal struct {
	Kind   string `json:"kind"`
	Action string `json:"action"`
	Scope  string `json:"scope"`
	Target string `json:"target"`
	Path   string `json:"path"`
	At     string `json:"at"`
}

type MessageRequest struct {
	Messages []Message `json:"messages"`
	Signals  []Signal  `json:"signals"`
	// Persona asks for a specific persona by slug; empty lets Vaultix route.
	Persona string `json:"persona"`
}

// Action records a tool the assistant ran for this answer.
type Action struct {
	Tool   string `json:"tool"`
	Domain string `json:"domain"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// PersonaRef names the persona that answered.
type PersonaRef struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role Role   `json:"role"`
}

type Reply struct {
	Text     string
	Actions  []Action
	Persona  PersonaRef
	RoutedBy string // mention, page, router or default
	Provider *Provider
}

var (
	signalWord = regexp.MustCompile(`^[a-z0-9][a-z0-9._:-]{0,95}$`)
	signalPath = regexp.MustCompile(`^/[A-Za-z0-9/_.~%-]{0,255}$`)
	mention    = regexp.MustCompile(`^\s*@([a-z][a-z0-9-]{1,31})\b`)
	safeTool   = regexp.MustCompile(`[^A-Za-z0-9_-]`)
)

// ValidateRequest bounds a chat turn before anything is sent to a model.
func ValidateRequest(request *MessageRequest) error {
	if len(request.Messages) == 0 || len(request.Messages) > maxMessages {
		return errutil.BadRequest("Send between 1 and %d messages.", maxMessages)
	}
	for i, message := range request.Messages {
		if message.Role != "user" && message.Role != "assistant" {
			return errutil.BadRequest("Message %d has role '%s'; use 'user' or 'assistant'.", i+1, message.Role)
		}
		if strings.TrimSpace(message.Content) == "" || len(message.Content) > maxMessageLength {
			return errutil.BadRequest("Message %d must have 1 to %d characters.", i+1, maxMessageLength)
		}
	}
	if request.Messages[len(request.Messages)-1].Role != "user" {
		return errutil.BadRequest("The last message must be the person's.")
	}
	if request.Persona != "" && !slugPattern.MatchString(request.Persona) {
		return errutil.BadRequest("Persona '%s' is not a persona slug.", request.Persona)
	}
	if len(request.Signals) > maxSignals {
		return errutil.BadRequest("Send at most %d signals.", maxSignals)
	}
	for i, signal := range request.Signals {
		if signal.Kind != "action" && signal.Kind != "navigate" {
			return errutil.BadRequest("Signal %d has kind '%s'; use 'action' or 'navigate'.", i+1, signal.Kind)
		}
		for _, word := range []string{signal.Action, signal.Scope, signal.Target} {
			if word != "" && !signalWord.MatchString(word) {
				return errutil.BadRequest("Signal %d names an action, scope or target that is not a catalog word.", i+1)
			}
		}
		if signal.Kind == "action" && signal.Action == "" {
			return errutil.BadRequest("Signal %d is an action without an action name.", i+1)
		}
		if signal.Path != "" && !signalPath.MatchString(signal.Path) {
			return errutil.BadRequest("Signal %d has a path that is not an application path.", i+1)
		}
		if signal.At != "" {
			if _, err := time.Parse(time.RFC3339, signal.At); err != nil {
				return errutil.BadRequest("Signal %d has a time that is not RFC 3339.", i+1)
			}
		}
	}
	return nil
}

// ToolHost lists and runs a warp point's MCP tools as the signed-in person.
type ToolHost interface {
	List(ctx context.Context, bearer, domain string) ([]MCPTool, error)
	Call(ctx context.Context, bearer, domain, name string, arguments json.RawMessage) (string, bool, error)
}

type MCPTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
	Annotations struct {
		ReadOnlyHint *bool `json:"readOnlyHint"`
	} `json:"annotations"`
}

// readOnly reports whether a tool declares that it changes nothing. Tools that
// change something wait for the approval flow in docs/0124.
func (t *MCPTool) readOnly() bool {
	return t.Annotations.ReadOnlyHint != nil && *t.Annotations.ReadOnlyHint
}

// MCPClient calls this instance's own warp points over loopback with the
// person's bearer, so every tool runs under that person's authorization.
type MCPClient struct {
	BaseURL string
	Client  *http.Client
}

// errNoWarpPoint marks a domain whose warp point is planned, not live.
var errNoWarpPoint = errors.New("warp point not live")

func (c *MCPClient) rpc(ctx context.Context, bearer, domain, method string, params any) (json.RawMessage, error) {
	if !slices.Contains(Domains, domain) {
		return nil, fmt.Errorf("unknown domain %q", domain)
	}
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/vx/v1/"+domain+"/mcp", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+bearer)
	response, err := c.Client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxMCPBytes))
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusNotFound && method == "tools/list" {
		return nil, errNoWarpPoint
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, &toolRefusal{status: response.StatusCode}
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	if envelope.Error != nil {
		return nil, &toolRefusal{message: envelope.Error.Message}
	}
	return envelope.Result, nil
}

type toolRefusal struct {
	status  int
	message string
}

func (e *toolRefusal) Error() string {
	switch {
	case e.message != "":
		return e.message
	case e.status == http.StatusUnauthorized:
		return "Your session does not allow this action."
	case e.status == http.StatusNotFound || e.status == http.StatusForbidden:
		return "This resource is unavailable to you."
	case e.status == http.StatusBadRequest:
		return "The action's arguments were not accepted."
	case e.status == http.StatusTooManyRequests:
		return "Too many actions; try again in a minute."
	}
	return "Vaultix could not complete the action."
}

func (c *MCPClient) List(ctx context.Context, bearer, domain string) ([]MCPTool, error) {
	raw, err := c.rpc(ctx, bearer, domain, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}
	var result struct {
		Tools []MCPTool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result.Tools, nil
}

func (c *MCPClient) Call(ctx context.Context, bearer, domain, name string, arguments json.RawMessage) (string, bool, error) {
	raw, err := c.rpc(ctx, bearer, domain, "tools/call", map[string]any{"name": name, "arguments": objectOrEmpty(arguments)})
	if err != nil {
		var refusal *toolRefusal
		if errors.As(err, &refusal) {
			return refusal.Error(), true, nil
		}
		return "", false, err
	}
	var result struct {
		IsError bool `json:"isError"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", false, err
	}
	var text []string
	for _, block := range result.Content {
		if block.Type == "text" {
			text = append(text, block.Text)
		}
	}
	return strings.Join(text, "\n"), result.IsError, nil
}

// ModelSource resolves the model a persona runs on: its own provider when it
// names one, otherwise the instance's active provider.
type ModelSource func(ctx context.Context, persona *Persona) (Model, *Provider, error)

// Agent routes a chat turn to a persona and answers it.
type Agent struct {
	logger *slog.Logger
	tools  ToolHost
}

func NewAgent(logger *slog.Logger, tools ToolHost) *Agent {
	return &Agent{logger: logger.With(slog.String("service", "assistant-agent")), tools: tools}
}

// modelToolName makes an MCP tool name acceptable to every provider, which
// allow only letters, digits, '_' and '-'.
func modelToolName(name string) string {
	safe := safeTool.ReplaceAllString(strings.ReplaceAll(name, ".", "__"), "_")
	if len(safe) > 64 {
		safe = safe[:64]
	}
	return safe
}

// pageDomains maps application paths to the domain the person is working in.
// It is a routing hint only; tools still enforce everything.
var pageDomains = []struct{ fragment, domain string }{
	{"/secret-scanning", "detect"},
	{"/cert-manager", "pki"},
	{"/kms", "kms"},
	{"/pam", "pam"},
	{"/audit-logs", "governance"},
	{"/app-connections", "connect"},
	{"/integrations", "connect"},
	{"/secret-syncs", "connect"},
	{"/access-management", "access"},
	{"/identities", "access"},
	{"/members", "access"},
	{"/roles", "access"},
	{"/secret-manager", "secrets"},
	{"/secrets", "secrets"},
	{"/admin", "operate"},
	{"/settings", "workspace"},
}

// signalDomain is the domain of the most recent signal that names one.
func signalDomain(signals []Signal) string {
	for i := len(signals) - 1; i >= 0; i-- {
		s := signals[i]
		if s.Kind == "action" {
			if parts := strings.Split(s.Action, "."); len(parts) > 2 && parts[0] == "vaultix" && slices.Contains(Domains, parts[1]) {
				return parts[1]
			}
		}
		for _, page := range pageDomains {
			if strings.Contains(s.Path, page.fragment) {
				return page.domain
			}
		}
	}
	return ""
}

func describeSignals(signals []Signal) string {
	if len(signals) == 0 {
		return "No recent activity was shared."
	}
	lines := make([]string, 0, len(signals))
	for _, signal := range signals {
		parts := []string{signal.Kind}
		if signal.Action != "" {
			parts = append(parts, signal.Action)
		}
		if signal.Scope != "" {
			parts = append(parts, "scope "+signal.Scope)
		}
		if signal.Target != "" {
			parts = append(parts, "target "+signal.Target)
		}
		if signal.Path != "" {
			parts = append(parts, "on "+signal.Path)
		}
		lines = append(lines, "- "+strings.Join(parts, " "))
	}
	return "Recent activity, oldest first:\n" + strings.Join(lines, "\n")
}

// route picks the persona for this message.
func (a *Agent) route(ctx context.Context, personas []Persona, models ModelSource, request *MessageRequest) (*Persona, string) {
	var router *Persona
	specialists := []*Persona{}
	bySlug := map[string]*Persona{}
	for i := range personas {
		p := &personas[i]
		if !p.Enabled {
			continue
		}
		bySlug[p.Slug] = p
		switch p.Role {
		case RoleRouter:
			router = p
		case RoleSpecialist:
			specialists = append(specialists, p)
		}
	}
	answerable := func(slug string) *Persona {
		if p, ok := bySlug[slug]; ok && p.Role != RoleGuard {
			return p
		}
		return nil
	}
	if p := answerable(request.Persona); p != nil {
		return p, "mention"
	}
	if m := mention.FindStringSubmatch(request.Messages[len(request.Messages)-1].Content); m != nil {
		if p := answerable(m[1]); p != nil {
			return p, "mention"
		}
	}
	if domain := signalDomain(request.Signals); domain != "" {
		for _, p := range specialists {
			if slices.Contains(p.Domains, domain) {
				return p, "page"
			}
		}
	}
	if router == nil {
		return nil, ""
	}
	if len(specialists) > 0 {
		if model, _, err := models(ctx, router); err == nil {
			choices := []string{router.Slug + ": " + router.Description}
			for _, p := range specialists {
				choices = append(choices, p.Slug+": "+p.Description)
			}
			answer, err := model.Chat(ctx, &ChatRequest{MaxTokens: routeTokens,
				System: "Choose who should answer the person's last message. Reply with exactly one slug from this list and nothing else:\n" + strings.Join(choices, "\n"),
				Turns:  []Turn{{Role: "user", Text: request.Messages[len(request.Messages)-1].Content}}})
			if err == nil {
				choice := strings.Trim(strings.ToLower(strings.TrimSpace(answer.Text)), "`'\".")
				if p := answerable(choice); p != nil && p.Role == RoleSpecialist {
					return p, "router"
				}
			}
		}
	}
	return router, "default"
}

type boundTool struct {
	domain, name string
}

// Answer routes the message, then lets the chosen persona call its domains'
// read-only tools for a bounded number of rounds.
func (a *Agent) Answer(ctx context.Context, personas []Persona, models ModelSource, bearer string, request *MessageRequest) (*Reply, error) {
	persona, routedBy := a.route(ctx, personas, models, request)
	if persona == nil {
		return nil, errutil.BadRequest("No assistant persona is turned on. An instance administrator can turn one on under Admin > AI assistant.")
	}
	model, provider, err := models(ctx, persona)
	if err != nil {
		return nil, err
	}

	bound := map[string]boundTool{}
	specs := []ToolSpec{}
	for _, domain := range persona.Domains {
		tools, err := a.tools.List(ctx, bearer, domain)
		if err != nil {
			if !errors.Is(err, errNoWarpPoint) {
				a.logger.Warn("assistant could not list a warp point", slog.String("domain", domain), slog.String("error", err.Error()))
			}
			continue
		}
		for i := range tools {
			tool := &tools[i]
			safe := modelToolName(tool.Name)
			if _, taken := bound[safe]; taken || safe == "" || !tool.readOnly() {
				continue
			}
			bound[safe] = boundTool{domain: domain, name: tool.Name}
			specs = append(specs, ToolSpec{Name: safe, Description: tool.Description, InputSchema: tool.InputSchema})
		}
	}

	turns := make([]Turn, 0, len(request.Messages)+2*maxRounds)
	for _, message := range request.Messages {
		turns = append(turns, Turn{Role: message.Role, Text: message.Content})
	}
	system := standingRules + "\n\n" + persona.Instructions + "\n\n" + describeSignals(request.Signals)
	chat := &ChatRequest{System: system, Tools: specs, MaxTokens: answerTokens}
	reply := &Reply{Persona: PersonaRef{Slug: persona.Slug, Name: persona.Name, Role: persona.Role}, RoutedBy: routedBy,
		Provider: provider, Actions: []Action{}}
	for round := 0; ; round++ {
		chat.Turns = turns
		if round == maxRounds {
			chat.Tools = nil
		}
		answer, err := model.Chat(ctx, chat)
		if err != nil {
			return nil, err
		}
		if len(answer.ToolCalls) == 0 || round == maxRounds {
			reply.Text = strings.TrimSpace(answer.Text)
			if reply.Text == "" {
				reply.Text = "I could not put together an answer. Try asking in a different way."
			}
			return reply, nil
		}
		calls := answer.ToolCalls
		if len(calls) > maxCallsPerRound {
			calls = calls[:maxCallsPerRound]
		}
		turns = append(turns, Turn{Role: "assistant", Text: answer.Text, ToolCalls: calls})
		results := make([]ToolResult, 0, len(calls))
		for _, call := range calls {
			tool, ok := bound[call.Name]
			if !ok {
				results = append(results, ToolResult{CallID: call.ID, Content: fmt.Sprintf("There is no tool named %q.", call.Name), IsError: true})
				reply.Actions = append(reply.Actions, Action{Tool: call.Name, Status: "failed", Error: "Unknown tool."})
				continue
			}
			text, isError, err := a.tools.Call(ctx, bearer, tool.domain, tool.name, call.Arguments)
			if err != nil {
				a.logger.Warn("assistant tool call failed", slog.String("tool", tool.name), slog.String("error", err.Error()))
				text, isError = "Vaultix could not run this action.", true
			}
			if len(text) > maxToolResultChars {
				text = text[:maxToolResultChars] + "\n[truncated]"
			}
			results = append(results, ToolResult{CallID: call.ID, Content: text, IsError: isError})
			action := Action{Tool: tool.name, Domain: tool.domain, Status: "ran"}
			if isError {
				action.Status, action.Error = "failed", firstLine(text)
			}
			reply.Actions = append(reply.Actions, action)
		}
		turns = append(turns, Turn{Role: "tool", Results: results})
	}
}

func firstLine(text string) string {
	line, _, _ := strings.Cut(text, "\n")
	if len(line) > 200 {
		line = line[:200]
	}
	return line
}
