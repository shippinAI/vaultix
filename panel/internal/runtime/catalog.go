package runtime

import (
	"fmt"
	"sort"
	"strings"
)

// A2UI protocol pin. v1.0 is chartered work, not a drive-by.
const A2UIVersion = "v0.9.1"

const (
	KnowledgeCatalogID   = "vaultix-knowledge"
	KnowledgeCatalogVer  = "1.0.0"
	ConfigureCatalogID   = "vaultix-configure"
	ConfigureCatalogVer  = "1.0.0"
	SurfaceKnowledge     = "vaultix-knowledge"
	SurfaceConfigure     = "vaultix-configure"
)

// AllowedComponents is the fail-closed A2UI catalog. Unknown ids do not render.
var AllowedComponents = map[string]bool{
	"glossary":        true,
	"did-you-know":    true,
	"knowledge-drop":  true,
	"configure-step":  true,
	"action-button":   true,
	"narration":       true,
	"stamp":           true,
	"next-hint":       true,
}

type Kind string

const (
	KindGlossary     Kind = "glossary"
	KindDidYouKnow   Kind = "did-you-know"
	KindKnowledgeDrop Kind = "knowledge-drop"
)

type Trigger struct {
	Kind          string `json:"kind"`
	Term          string `json:"term,omitempty"`
	RouteID       string `json:"routeId,omitempty"`
	ControlID     string `json:"controlId,omitempty"`
	InteractionID string `json:"interactionId,omitempty"`
}

type Entry struct {
	ID        string    `json:"id"`
	Kind      Kind      `json:"kind"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Version   string    `json:"version"`
	SourceDoc string    `json:"sourceDoc,omitempty"`
	Triggers  []Trigger `json:"triggers"`
}

func kindPrefix(k Kind) string {
	switch k {
	case KindDidYouKnow:
		return "knowledge.did-you-know."
	case KindKnowledgeDrop:
		return "knowledge.drop."
	default:
		return "knowledge.glossary."
	}
}

func normalizeTerm(term string) string {
	return strings.ToLower(strings.TrimSpace(term))
}

// AssertCatalog is catalog law: id namespace, unique ids, one glossary term each.
func AssertCatalog(entries []Entry) []Entry {
	ids := map[string]bool{}
	terms := map[string]bool{}
	for _, e := range entries {
		prefix := kindPrefix(e.Kind)
		if !strings.HasPrefix(e.ID, prefix) {
			panic("runtime: " + e.ID + " is not in the " + string(e.Kind) + " namespace")
		}
		if ids[e.ID] {
			panic("runtime: duplicate knowledge id " + e.ID)
		}
		ids[e.ID] = true
		for _, t := range e.Triggers {
			if t.Kind != "glossary-term" {
				continue
			}
			term := normalizeTerm(t.Term)
			if terms[term] {
				panic("runtime: glossary term claimed twice: " + term)
			}
			terms[term] = true
		}
	}
	return entries
}

// Catalog is the weights-equivalent: stable ids, versions, trigger maps.
// Frontier models do not author entries at runtime.
func Catalog() []Entry {
	return AssertCatalog([]Entry{
		{
			ID: "knowledge.glossary.box", Kind: KindGlossary,
			Title: "Box", Version: "1.0.0",
			SourceDoc: "docs/0002-lovable-to-vibe.md",
			Body:      "A box is one vault for one app. Every key that app will ever need lives here. You do not make a new place for each key.",
			Triggers:  []Trigger{{Kind: "glossary-term", Term: "box"}},
		},
		{
			ID: "knowledge.glossary.key", Kind: KindGlossary,
			Title: "Key", Version: "1.0.0",
			SourceDoc: "docs/0002-lovable-to-vibe.md",
			Body:      "A key is a secret name plus a sealed value. The name is visible. The value never appears in chat, prompts, GET bodies, or A2UI.",
			Triggers:  []Trigger{{Kind: "glossary-term", Term: "key"}},
		},
		{
			ID: "knowledge.glossary.inject", Kind: KindGlossary,
			Title: "Inject", Version: "1.0.0",
			SourceDoc: "docs/0002-lovable-to-vibe.md",
			Body:      "Inject means the workspace asks Vaultix for the key. You never copy the value. A short-lived handle is the hand-off.",
			Triggers:  []Trigger{{Kind: "glossary-term", Term: "inject"}},
		},
		{
			ID: "knowledge.glossary.rotate", Kind: KindGlossary,
			Title: "Rotate", Version: "1.0.0",
			SourceDoc: "docs/0002-lovable-to-vibe.md",
			Body:      "Rotate means you change the value in the box. The workspace picks up the new value the next time it injects. You do not paste the new value into a prompt.",
			Triggers:  []Trigger{{Kind: "glossary-term", Term: "rotate"}},
		},
		{
			ID: "knowledge.did-you-know.never-in-chat", Kind: KindDidYouKnow,
			Title: "Did you know: keys are not chat", Version: "1.0.0",
			SourceDoc: "docs/0002-lovable-to-vibe.md",
			Body:      "If a key is in a prompt, it is already leaked. Vaultix is where it lives. Clyffy may pass a box name or an inject handle — never the value.",
			Triggers: []Trigger{
				{Kind: "route-opened", RouteID: "route.configure"},
				{Kind: "control-activated", ControlID: "control.store-key"},
			},
		},
		{
			ID: "knowledge.drop.configure", Kind: KindKnowledgeDrop,
			Title: "How to configure Vaultix", Version: "1.0.0",
			SourceDoc: "docs/0012-a2ui-mcp-configure.md",
			Body:      "Configure is a path, not a dashboard hunt. Meet the box, make it, put a key in it, then let the workspace ask Vaultix. Clyffy and you press the same steps.",
			Triggers: []Trigger{
				{Kind: "route-opened", RouteID: "route.configure"},
				{Kind: "interaction", InteractionID: "interaction.configure.start"},
			},
		},
		{
			ID: "knowledge.glossary.license", Kind: KindGlossary,
			Title: "License", Version: "1.0.0",
			SourceDoc: "docs/0013-license-and-membership.md",
			Body:      "A Vaultix license is issued by AngryVibes LLC on shippin.ai. Community is included. Membership and enterprise open extra valves. There is no leftover vendor license server.",
			Triggers:  []Trigger{{Kind: "glossary-term", Term: "license"}},
		},
		{
			ID: "knowledge.glossary.membership", Kind: KindGlossary,
			Title: "Membership", Version: "1.0.0",
			SourceDoc: "docs/0013-license-and-membership.md",
			Body:      "shippin.ai membership is how a hosted operator activates membership-tier Vaultix features. Nomen says who the member is. Vaultix does not store the account.",
			Triggers:  []Trigger{{Kind: "glossary-term", Term: "membership"}},
		},
		{
			ID: "knowledge.drop.mcp-is-the-buttons", Kind: KindKnowledgeDrop,
			Title: "MCP is the same buttons", Version: "1.0.0",
			SourceDoc: "docs/0012-a2ui-mcp-configure.md",
			Body:      "Vaultix MCP tools are the source actions and the catalog. A model does not get a second API. If the tool cannot do it, the viewport cannot either.",
			Triggers:  []Trigger{{Kind: "route-opened", RouteID: "route.mcp"}},
		},
	})
}

func triggerMatches(entry Trigger, fired Trigger) bool {
	if entry.Kind != fired.Kind {
		return false
	}
	switch fired.Kind {
	case "glossary-term":
		return normalizeTerm(entry.Term) == normalizeTerm(fired.Term)
	case "route-opened":
		return entry.RouteID == fired.RouteID
	case "control-activated":
		return entry.ControlID == fired.ControlID
	case "interaction":
		return entry.InteractionID == fired.InteractionID
	default:
		return false
	}
}

func matchEntry(fired Trigger, entries []Entry) *Entry {
	sorted := append([]Entry(nil), entries...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	for i := range sorted {
		for _, t := range sorted[i].Triggers {
			if triggerMatches(t, fired) {
				return &sorted[i]
			}
		}
	}
	return nil
}

func mustComponent(name string) {
	if !AllowedComponents[name] {
		panic(fmt.Sprintf("runtime: component %q is outside the A2UI catalog", name))
	}
}
