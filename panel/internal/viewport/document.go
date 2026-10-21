package viewport

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"shippin.cloud/vaultix/panel/internal/runtime"
	"shippin.cloud/vaultix/panel/internal/source"
)

// Document is the open UI input Clyffy reads instead of pixels.
// Stable ids, next action, no secrets, no prompts.
type Document struct {
	SchemaVersion int       `json:"schemaVersion"`
	Product       string    `json:"product"`
	RouteID       string    `json:"routeId"`
	Revision      string    `json:"revision"`
	Stamp         Stamp     `json:"stamp"`
	Next          *Action   `json:"next,omitempty"`
	Controls      []Control `json:"controls"`
	Actions       []Action  `json:"actions"`
	Configure     []runtime.Step `json:"configure"`
}

type Stamp struct {
	Owner  string `json:"owner"`
	Host   string `json:"host"`
	Trusts string `json:"trusts"`
	Voice  string `json:"presentedAs"`
}

type Control struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	RouteID  string `json:"routeId,omitempty"`
	ActionID string `json:"actionId,omitempty"`
}

type Action struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Method     string `json:"method,omitempty"`
	Path       string `json:"path,omitempty"`
	Label      string `json:"label"`
	Catalog    string `json:"catalog,omitempty"`
	Suggestion string `json:"suggestion,omitempty"`
}

func NormalizeRoute(routeID string) string {
	switch routeID {
	case "route.configure", "route.box", "route.inject", "route.mcp", "route.trust":
		return routeID
	default:
		return "route.configure"
	}
}

func Compose(routeID string) Document {
	routeID = NormalizeRoute(routeID)
	actions := []Action{}
	for _, a := range source.Manifest() {
		actions = append(actions, Action{
			ID: a.ID, Kind: "source", Label: a.Label,
			Method: "POST", Path: "/api/v1/vaultix/source/act",
			Catalog: a.Teaches, Suggestion: a.Narration,
		})
	}
	doc := Document{
		SchemaVersion: 1,
		Product:       "vaultix",
		RouteID:       routeID,
		Stamp: Stamp{
			Owner: "AngryVibes LLC", Host: "shippin.ai",
			Trusts: "nomen", Voice: "clyffy",
		},
		Controls: []Control{
			{ID: "control.configure", Kind: "route", Label: "Configure", RouteID: "route.configure"},
			{ID: "control.store-key", Kind: "action", Label: "Put a key in the box", ActionID: "vaultix.store-key"},
			{ID: "control.inject", Kind: "action", Label: "Hand a key to your workspace", ActionID: "vaultix.inject"},
		},
		Actions:   actions,
		Configure: runtime.Path(),
	}
	switch routeID {
	case "route.configure":
		doc.Next = &Action{
			ID: "interaction.configure.start", Kind: "configure",
			Label: "Show me how to configure", Catalog: "vaultix-configure",
			Suggestion: "Walk the authored path: box, then key, then inject.",
		}
	case "route.mcp":
		doc.Next = &Action{
			ID: "vaultix.runtime.answer", Kind: "mcp",
			Label: "Ask the catalog, not a model",
			Suggestion: "MCP tools are these same actions.",
		}
	}
	raw, _ := json.Marshal(doc)
	sum := sha256.Sum256(raw)
	doc.Revision = hex.EncodeToString(sum[:8])
	return doc
}
