package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"shippin.cloud/vaultix/panel/internal/runtime"
	"shippin.cloud/vaultix/panel/internal/source"
	"shippin.cloud/vaultix/panel/internal/viewport"
)

const ProtocolVersion = "2024-11-05"

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id,omitempty"`
	Result  any    `json:"result,omitempty"`
	Error   *Error `json:"error,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// Server is Vaultix MCP. Tools are the catalog, the viewport, and the
// source actions. There is no leftover-product tool surface.
type Server struct {
	Ops  source.Ops
	User string
}

func Tools() []Tool {
	obj := func(props map[string]any, required []string) map[string]any {
		s := map[string]any{"type": "object", "additionalProperties": false, "properties": props}
		if len(required) > 0 {
			s["required"] = required
		}
		return s
	}
	return []Tool{
		{
			Name:        "vaultix.runtime.answer",
			Description: "Catalog-first A2UI answer. Same trigger always yields the same decision. Do not call a model for glossary or configure.",
			InputSchema: obj(map[string]any{
				"surfaceId": map[string]any{"type": "string"},
				"kind":      map[string]any{"type": "string", "enum": []string{"glossary-term", "route-opened", "control-activated", "interaction"}},
				"term":      map[string]any{"type": "string"},
				"routeId":   map[string]any{"type": "string"},
				"controlId": map[string]any{"type": "string"},
				"interactionId": map[string]any{"type": "string"},
			}, []string{"kind"}),
		},
		{
			Name:        "vaultix.viewport.get",
			Description: "Open UI input for the Vaultix viewport. Stable ids, next action, no secret values.",
			InputSchema: obj(map[string]any{
				"routeId": map[string]any{"type": "string"},
			}, nil),
		},
		{
			Name:        "vaultix.configure.show",
			Description: "Authored configure path as A2UI. Walk this instead of inventing setup.",
			InputSchema: obj(map[string]any{
				"index": map[string]any{"type": "integer", "minimum": 0},
			}, nil),
		},
		{
			Name:        "vaultix.source.manifest",
			Description: "Operator actions. Human and Clyffy use this same list.",
			InputSchema: obj(map[string]any{}, nil),
		},
		{
			Name:        "vaultix.source.act",
			Description: "Run a source action. Returns narrated steps. Never returns a secret value.",
			InputSchema: obj(map[string]any{
				"actionId": map[string]any{"type": "string"},
				"actor":    map[string]any{"type": "string", "enum": []string{"operator", "clyffy"}},
				"inputs":   map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
			}, []string{"actionId"}),
		},
	}
}

func (s *Server) Handle(ctx context.Context, raw []byte) Response {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return Response{JSONRPC: "2.0", Error: &Error{Code: -32700, Message: "parse error"}}
	}
	if req.JSONRPC == "" {
		req.JSONRPC = "2.0"
	}
	switch req.Method {
	case "initialize":
		return ok(req.ID, map[string]any{
			"protocolVersion": ProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "vaultix", "version": "1.0.0"},
			"instructions":    "Catalog first. A2UI only. Never request or echo secret values. Configure is vaultix.configure.show, not a prompt.",
		})
	case "notifications/initialized", "notifications/cancelled":
		return Response{JSONRPC: "2.0"}
	case "tools/list":
		return ok(req.ID, map[string]any{"tools": Tools()})
	case "tools/call":
		return s.call(ctx, req)
	case "ping":
		return ok(req.ID, map[string]any{})
	default:
		return Response{JSONRPC: "2.0", ID: req.ID, Error: &Error{Code: -32601, Message: "method not found"}}
	}
}

func (s *Server) call(ctx context.Context, req Request) Response {
	var p struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return Response{JSONRPC: "2.0", ID: req.ID, Error: &Error{Code: -32602, Message: "invalid params"}}
	}
	if p.Arguments == nil {
		p.Arguments = map[string]any{}
	}
	result, err := s.exec(ctx, p.Name, p.Arguments)
	if err != nil {
		return ok(req.ID, map[string]any{
			"content": []map[string]any{{"type": "text", "text": err.Error()}},
			"isError": true,
		})
	}
	text, _ := json.Marshal(result)
	secret := ""
	if ins, ok := p.Arguments["inputs"].(map[string]any); ok {
		secret, _ = ins["value"].(string)
	}
	if secret != "" && strings.Contains(string(text), secret) {
		return ok(req.ID, map[string]any{
			"content": []map[string]any{{"type": "text", "text": "refused: response would include a secret value"}},
			"isError": true,
		})
	}
	return ok(req.ID, map[string]any{
		"content": []map[string]any{{"type": "text", "text": string(text)}},
		"isError": false,
	})
}

func (s *Server) exec(ctx context.Context, name string, args map[string]any) (any, error) {
	switch name {
	case "vaultix.runtime.answer":
		tr := triggerFrom(args)
		sid, _ := args["surfaceId"].(string)
		return runtime.Decide(sid, tr, runtime.DecideOpts{}), nil
	case "vaultix.viewport.get":
		route, _ := args["routeId"].(string)
		return viewport.Compose(route), nil
	case "vaultix.configure.show":
		idx := 0
		switch n := args["index"].(type) {
		case float64:
			idx = int(n)
		case int:
			idx = n
		}
		return map[string]any{
			"index":    runtime.ClampIndex(idx),
			"step":     runtime.Path()[runtime.ClampIndex(idx)],
			"messages": runtime.Show(idx),
		}, nil
	case "vaultix.source.manifest":
		return map[string]any{"boundary": "vaultix", "actions": source.Manifest()}, nil
	case "vaultix.source.act":
		if s.Ops == nil {
			return nil, fmt.Errorf("vaultix engine not configured")
		}
		actionID, _ := args["actionId"].(string)
		actor := source.ActorClyffy
		if a, _ := args["actor"].(string); a == string(source.ActorOperator) {
			actor = source.ActorOperator
		}
		inputs := map[string]string{}
		if raw, ok := args["inputs"].(map[string]any); ok {
			for k, v := range raw {
				inputs[k], _ = v.(string)
			}
		}
		user := s.User
		if user == "" {
			user = "mcp"
		}
		return source.Driver{Ops: s.Ops}.Execute(ctx, actionID, actor, user, inputs)
	default:
		return nil, fmt.Errorf("unknown tool %s", name)
	}
}

func triggerFrom(args map[string]any) runtime.Trigger {
	kind, _ := args["kind"].(string)
	t := runtime.Trigger{Kind: kind}
	t.Term, _ = args["term"].(string)
	t.RouteID, _ = args["routeId"].(string)
	t.ControlID, _ = args["controlId"].(string)
	t.InteractionID, _ = args["interactionId"].(string)
	return t
}

func ok(id any, result any) Response {
	return Response{JSONRPC: "2.0", ID: id, Result: result}
}


