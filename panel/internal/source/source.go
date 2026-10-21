// Package source is the Vaultix "source API" (doc 0009): the operable,
// observable surface of the panel. Every operator action is a typed command
// with a plain-language label and narration, issuable identically by a human
// click or by a Vaultix specialist Clyffy. Execution returns ordered,
// narrated steps — the viewport renders exactly what happened, at
// human-watchable pace, so the user learns passively. Nothing runs behind
// the scenes: every action is observable and audited, whoever the actor is.
package source

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Actor is who is driving. Human and Clyffy use the identical action set;
// the actor is recorded so a Clyffy action is never a hidden path.
type Actor string

const (
	ActorOperator Actor = "operator"
	ActorClyffy   Actor = "clyffy"
)

// Input describes one field an action needs, in plain language.
type Input struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Required bool   `json:"required"`
	Secret   bool   `json:"secret"` // value is a secret; never echoed in steps
}

// Action is one operable, observable command.
type Action struct {
	ID         string  `json:"id"`
	Label      string  `json:"label"`     // plain: "Make a box for this app"
	Narration  string  `json:"narration"` // the sentence Clyffy speaks doing it
	Teaches    string  `json:"teaches"`   // the lesson it demonstrates (doc 0002)
	Inputs     []Input `json:"inputs"`
	Capability string  `json:"capability"` // panel contract capability it mirrors
	Elevated   bool    `json:"elevated"`   // requires PIN step-up
}

// Step is one observable moment of an execution. Metadata only — a Step
// never carries a secret value.
type Step struct {
	Narration string `json:"narration"`
	Status    string `json:"status"` // running | done | failed
	Detail    string `json:"detail,omitempty"`
}

// Result is the observable record of an execution: the ordered steps the
// viewport renders, plus metadata-only outcome fields.
type Result struct {
	ActionID string         `json:"actionId"`
	Actor    Actor          `json:"actor"`
	Steps    []Step         `json:"steps"`
	Outcome  string         `json:"outcome"` // ok | failed
	Meta     map[string]any `json:"meta,omitempty"`
}

// Manifest is the action set — the same catalog the UI renders and a Clyffy
// discovers. Ordered as the guided path (doc 0002 lesson ladder).
func Manifest() []Action {
	return []Action{
		{
			ID: "vaultix.make-box", Label: "Make a box for this app",
			Narration:  "Making one box that will hold every key this app needs.",
			Teaches:    "vaultix.lesson.one-project",
			Inputs:     []Input{{Name: "name", Label: "App name", Required: true}},
			Capability: "vaultix.project.create", Elevated: true,
		},
		{
			ID: "vaultix.store-key", Label: "Put a key in the box",
			Narration: "Storing this key in your vault — never in a chat or prompt.",
			Teaches:   "vaultix.lesson.keys-are-not-chat",
			Inputs: []Input{
				{Name: "projectId", Label: "Which box", Required: true},
				{Name: "environment", Label: "Where it's used", Required: true},
				{Name: "name", Label: "Key name", Required: true},
				{Name: "value", Label: "Key value", Required: true, Secret: true},
			},
			Capability: "vaultix.secret.put", Elevated: true,
		},
		{
			ID: "vaultix.inject", Label: "Hand a key to your workspace",
			Narration: "Your workspace asks the vault for the key — you never copy it.",
			Teaches:   "vaultix.lesson.inject-not-paste",
			Inputs: []Input{
				{Name: "projectId", Label: "Which box", Required: true},
				{Name: "environment", Label: "Where it's used", Required: true},
				{Name: "name", Label: "Key name", Required: false},
			},
			Capability: "vaultix.secret.inject", Elevated: true,
		},
	}
}

func lookup(id string) (Action, bool) {
	for _, a := range Manifest() {
		if a.ID == id {
			return a, true
		}
	}
	return Action{}, false
}

// Ops is what the driver calls to actually do the work — implemented by the
// panel over the Vaultix engine. The driver adds observability and
// narration; the effect is the same operation a human triggers.
type Ops interface {
	CreateProject(ctx context.Context, name string) (projectID string, err error)
	PutSecret(ctx context.Context, projectID, environment, name, value string) error
	Inject(ctx context.Context, user, projectID, environment, name string) (handle string, expiresAt time.Time, err error)
}

var ErrUnknownAction = errors.New("source: unknown action")
var ErrMissingInput = errors.New("source: missing required input")

// Driver executes actions and produces observable Results.
type Driver struct{ Ops Ops }

// Execute runs one action. It validates inputs, calls the underlying op, and
// returns the narrated, observable Result — identical whether the actor is a
// human or a Clyffy. Secret input values never appear in any Step.
func (d Driver) Execute(ctx context.Context, id string, actor Actor, user string, inputs map[string]string) (Result, error) {
	a, ok := lookup(id)
	if !ok {
		return Result{}, ErrUnknownAction
	}
	for _, in := range a.Inputs {
		if in.Required && inputs[in.Name] == "" {
			return Result{}, fmt.Errorf("%w: %s", ErrMissingInput, in.Name)
		}
	}
	res := Result{ActionID: id, Actor: actor, Meta: map[string]any{}}
	fail := func(step string, err error) (Result, error) {
		res.Steps = append(res.Steps, Step{Narration: step, Status: "failed", Detail: err.Error()})
		res.Outcome = "failed"
		return res, err
	}

	switch id {
	case "vaultix.make-box":
		res.Steps = append(res.Steps, Step{Narration: a.Narration, Status: "running"})
		pid, err := d.Ops.CreateProject(ctx, inputs["name"])
		if err != nil {
			return fail("Couldn't make the box.", err)
		}
		res.Meta["projectId"] = pid
		res.Steps = append(res.Steps, Step{Narration: "Your box is ready. One place for every key.", Status: "done", Detail: "projectId=" + pid})

	case "vaultix.store-key":
		res.Steps = append(res.Steps, Step{Narration: a.Narration, Status: "running"})
		if err := d.Ops.PutSecret(ctx, inputs["projectId"], inputs["environment"], inputs["name"], inputs["value"]); err != nil {
			return fail("Couldn't store the key.", err)
		}
		// The value is never echoed — only the fact it was stored.
		res.Steps = append(res.Steps, Step{Narration: "Stored. The value stayed in your vault the whole time.", Status: "done", Detail: inputs["name"]})

	case "vaultix.inject":
		res.Steps = append(res.Steps, Step{Narration: a.Narration, Status: "running"})
		handle, exp, err := d.Ops.Inject(ctx, user, inputs["projectId"], inputs["environment"], inputs["name"])
		if err != nil {
			return fail("Couldn't hand the key over.", err)
		}
		res.Meta["handle"] = handle
		res.Meta["expiresAt"] = exp.UTC()
		res.Steps = append(res.Steps, Step{Narration: "Injected. Nothing was pasted — the workspace fetched it directly.", Status: "done"})

	default:
		return Result{}, ErrUnknownAction
	}

	res.Outcome = "ok"
	return res, nil
}
