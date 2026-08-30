package source

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeOps struct {
	createdName string
	putValue    string
	injected    bool
	failPut     bool
}

func (f *fakeOps) CreateProject(_ context.Context, name string) (string, error) {
	f.createdName = name
	return "proj-1", nil
}
func (f *fakeOps) PutSecret(_ context.Context, projectID, env, name, value string) error {
	if f.failPut {
		return errors.New("core down")
	}
	f.putValue = value
	return nil
}
func (f *fakeOps) Inject(_ context.Context, user, projectID, env, name string) (string, time.Time, error) {
	f.injected = true
	return "handle-abc", time.Now().Add(90 * time.Second), nil
}

func TestManifestIsPlainAndComplete(t *testing.T) {
	m := Manifest()
	if len(m) == 0 {
		t.Fatal("empty manifest")
	}
	for _, a := range m {
		if a.Label == "" || a.Narration == "" || a.Capability == "" {
			t.Errorf("action %s missing label/narration/capability", a.ID)
		}
	}
}

func TestExecuteMakeBoxNarrates(t *testing.T) {
	f := &fakeOps{}
	res, err := Driver{Ops: f}.Execute(context.Background(), "vaultix.make-box", ActorOperator, "u", map[string]string{"name": "myapp"})
	if err != nil {
		t.Fatal(err)
	}
	if f.createdName != "myapp" {
		t.Fatalf("op not called with name, got %q", f.createdName)
	}
	if res.Outcome != "ok" || len(res.Steps) < 2 {
		t.Fatalf("expected narrated ok result, got %+v", res)
	}
	if res.Meta["projectId"] != "proj-1" {
		t.Fatalf("missing projectId meta: %v", res.Meta)
	}
}

func TestStoreKeyNeverLeaksValue(t *testing.T) {
	f := &fakeOps{}
	res, err := Driver{Ops: f}.Execute(context.Background(), "vaultix.store-key", ActorClyffy, "u", map[string]string{
		"projectId": "proj-1", "environment": "dev", "name": "OPENAI_API_KEY", "value": "sk-supersecret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if f.putValue != "sk-supersecret" {
		t.Fatal("value did not reach the op")
	}
	// The observable result (what the viewport renders) must never contain
	// the secret value.
	raw, _ := json.Marshal(res)
	if strings.Contains(string(raw), "sk-supersecret") {
		t.Fatal("secret value leaked into the observable Result")
	}
	if res.Actor != ActorClyffy {
		t.Fatal("actor not recorded")
	}
}

func TestInjectTeachesNotPaste(t *testing.T) {
	f := &fakeOps{}
	res, err := Driver{Ops: f}.Execute(context.Background(), "vaultix.inject", ActorOperator, "u", map[string]string{
		"projectId": "proj-1", "environment": "dev",
	})
	if err != nil || !f.injected {
		t.Fatalf("inject not performed: %v", err)
	}
	raw, _ := json.Marshal(res)
	if !strings.Contains(strings.ToLower(string(raw)), "pasted") {
		t.Fatalf("inject narration should teach inject-not-paste: %s", raw)
	}
}

func TestMissingInputRejected(t *testing.T) {
	_, err := Driver{Ops: &fakeOps{}}.Execute(context.Background(), "vaultix.make-box", ActorOperator, "u", map[string]string{})
	if !errors.Is(err, ErrMissingInput) {
		t.Fatalf("want ErrMissingInput, got %v", err)
	}
}

func TestUnknownActionRejected(t *testing.T) {
	_, err := Driver{Ops: &fakeOps{}}.Execute(context.Background(), "vaultix.nope", ActorOperator, "u", nil)
	if !errors.Is(err, ErrUnknownAction) {
		t.Fatalf("want ErrUnknownAction, got %v", err)
	}
}

func TestFailedOpProducesObservableFailedStep(t *testing.T) {
	f := &fakeOps{failPut: true}
	res, err := Driver{Ops: f}.Execute(context.Background(), "vaultix.store-key", ActorOperator, "u", map[string]string{
		"projectId": "p", "environment": "dev", "name": "K", "value": "v",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if res.Outcome != "failed" || res.Steps[len(res.Steps)-1].Status != "failed" {
		t.Fatalf("failure must be observable in steps: %+v", res)
	}
}
