package runtime

import "shippin.cloud/vaultix/panel/internal/source"

// Step is one authored beat of "show the user how to configure."
// This is not a model plan. The order is the product.
type Step struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Body         string `json:"body"`
	GlossaryTerm string `json:"glossaryTerm,omitempty"`
	ActionID     string `json:"actionId,omitempty"`
	Lesson       string `json:"lesson"`
}

// Path is the configure ladder. Authored ahead of time so ML does not
// invent a setup flow. Human and Clyffy walk the same steps.
func Path() []Step {
	return []Step{
		{
			ID: "what-a-box-is", Title: "One box per app",
			GlossaryTerm: "box", Lesson: "vaultix.lesson.one-project",
			Body: "Every app gets one box. That box holds every key the app will ever need. You are not making a folder per key.",
		},
		{
			ID: "make-the-box", Title: "Make the box",
			ActionID: "vaultix.make-box", Lesson: "vaultix.lesson.one-project",
			Body: "Name the app. Vaultix makes the box. You will watch it happen in this viewport — nothing runs behind the glass.",
		},
		{
			ID: "keys-are-not-chat", Title: "Keys are not chat",
			GlossaryTerm: "key", Lesson: "vaultix.lesson.keys-are-not-chat",
			Body: "If the value is in a prompt, it is already leaked. The next step stores the key in the box. The value will not come back on the screen.",
		},
		{
			ID: "put-the-key", Title: "Put a key in the box",
			ActionID: "vaultix.store-key", Lesson: "vaultix.lesson.keys-are-not-chat",
			Body: "Give the key a name (API_KEY) and the place it is used (dev). The value stays sealed. GET will only ever show the name.",
		},
		{
			ID: "hand-it-over", Title: "The workspace asks Vaultix",
			ActionID: "vaultix.inject", Lesson: "vaultix.lesson.inject-not-paste",
			GlossaryTerm: "inject",
			Body: "Inject mints a short-lived handle. The workspace redeems it. You do not copy the value into a .env or a chat.",
		},
	}
}

// Show builds the A2UI surface for one configure step. Catalog entries
// for glossary terms are inlined as sibling components so the model is
// not asked what a "box" is.
func Show(index int) []Message {
	steps := Path()
	if index < 0 {
		index = 0
	}
	if index >= len(steps) {
		index = len(steps) - 1
	}
	step := steps[index]
	root := []Component{
		{
			ID: "stamp", Component: "stamp", TemplateVersion: "1.0.0",
			Properties: map[string]any{
				"product": "Vaultix", "owner": "AngryVibes LLC",
				"presentedAs": "clyffy", "step": index + 1, "of": len(steps),
			},
		},
		{
			ID: "narration", Component: "narration", TemplateVersion: "1.0.0",
			Properties: map[string]any{"text": step.Body, "title": step.Title},
		},
		{
			ID: "step", Component: "configure-step", TemplateVersion: "1.0.0",
			Properties: map[string]any{
				"id": step.ID, "title": step.Title, "lesson": step.Lesson,
				"index": index, "last": index == len(steps)-1,
			},
		},
	}
	if step.ActionID != "" {
		label := step.Title
		for _, a := range source.Manifest() {
			if a.ID == step.ActionID {
				label = a.Label
				break
			}
		}
		root = append(root, Component{
			ID: "act", Component: "action-button", TemplateVersion: "1.0.0",
			Properties: map[string]any{"actionId": step.ActionID, "label": label},
		})
	}
	if index < len(steps)-1 {
		root = append(root, Component{
			ID: "next", Component: "next-hint", TemplateVersion: "1.0.0",
			Properties: map[string]any{
				"nextId": steps[index+1].ID, "nextTitle": steps[index+1].Title,
			},
		})
	}

	model := map[string]any{
		"source": "catalog", "presentedAs": "clyffy",
		"routeId": "route.configure", "stepId": step.ID,
		"index": index, "lesson": step.Lesson, "title": step.Title, "body": step.Body,
	}
	if step.ActionID != "" {
		model["actionId"] = step.ActionID
	}

	msgs := []Message{
		createSurface(SurfaceConfigure, ConfigureCatalogID, ConfigureCatalogVer, "step"),
		updateComponents(SurfaceConfigure, root),
		updateDataModel(SurfaceConfigure, model),
	}
	if step.GlossaryTerm != "" {
		d := Decide(SurfaceKnowledge, Trigger{Kind: "glossary-term", Term: step.GlossaryTerm}, DecideOpts{})
		if d.Reason == ReasonCatalogMatch {
			msgs = append(msgs, d.Messages...)
		}
	}
	return msgs
}

func ClampIndex(index int) int {
	n := len(Path())
	if index < 0 {
		return 0
	}
	if index >= n {
		return n - 1
	}
	return index
}
