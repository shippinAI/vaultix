package syncer

import (
	"context"
	"testing"

	"shippin.cloud/vaultix/internal/api"
	"shippin.cloud/vaultix/internal/store"
)

type fake struct{ s map[string]api.Secret }

func (f *fake) List(context.Context, api.Scope) ([]api.Secret, error) {
	var out []api.Secret
	for _, v := range f.s {
		out = append(out, v)
	}
	return out, nil
}
func (f *fake) Put(_ context.Context, _ api.Scope, k, v string, create bool) (int, error) {
	n := f.s[k].Version + 1
	f.s[k] = api.Secret{Key: k, Value: v, Version: n}
	return n, nil
}
func (f *fake) Delete(_ context.Context, _ api.Scope, k string) error { delete(f.s, k); return nil }

func local(e map[string]store.Entry) *store.Scope {
	return &store.Scope{Entries: e, Deleted: map[string]int{}}
}

func TestPullNewAndChanged(t *testing.T) {
	f := &fake{s: map[string]api.Secret{"A": {Key: "A", Value: "a2", Version: 2}, "B": {Key: "B", Value: "b", Version: 1}}}
	l := local(map[string]store.Entry{"A": {Value: "a1", Base: 1}})
	r, _ := Sync(context.Background(), f, api.Scope{}, l, "ask", false, nil)
	if r.Pulled != 2 || l.Entries["A"].Value != "a2" || l.Entries["B"].Base != 1 {
		t.Fatalf("%+v %+v", r, l.Entries)
	}
}

func TestAutoCreateAndPush(t *testing.T) {
	f := &fake{s: map[string]api.Secret{"A": {Key: "A", Value: "a", Version: 1}}}
	l := local(map[string]store.Entry{"A": {Value: "a!", Base: 1, Dirty: true}, "NEW": {Value: "n", Dirty: true}})
	r, _ := Sync(context.Background(), f, api.Scope{}, l, "ask", true, nil)
	if r.Pushed != 1 || r.Created != 1 || f.s["NEW"].Value != "n" || f.s["A"].Value != "a!" || l.Entries["A"].Dirty {
		t.Fatalf("%+v %+v", r, f.s)
	}
}

func TestConflictPolicies(t *testing.T) {
	for _, tc := range []struct {
		pol  Policy
		want string
	}{{"remote", "srv"}, {"local", "mine"}, {"skip", "mine"}} {
		f := &fake{s: map[string]api.Secret{"A": {Key: "A", Value: "srv", Version: 3}}}
		l := local(map[string]store.Entry{"A": {Value: "mine", Base: 2, Dirty: true}})
		r, _ := Sync(context.Background(), f, api.Scope{}, l, tc.pol, true, nil)
		if r.Conflicts != 1 || l.Entries["A"].Value != tc.want {
			t.Fatalf("%s: %+v %+v", tc.pol, r, l.Entries)
		}
		if tc.pol == "skip" && f.s["A"].Value != "srv" {
			t.Fatal("skip must not touch the server")
		}
	}
}

func TestPullOnlyKeepsLocalEdits(t *testing.T) {
	f := &fake{s: map[string]api.Secret{"A": {Key: "A", Value: "a", Version: 1}}}
	l := local(map[string]store.Entry{"A": {Value: "edit", Base: 1, Dirty: true}})
	Sync(context.Background(), f, api.Scope{}, l, "ask", false, nil)
	if f.s["A"].Value != "a" || !l.Entries["A"].Dirty {
		t.Fatal("pull must not push")
	}
}

func TestLocalDeletePushed(t *testing.T) {
	f := &fake{s: map[string]api.Secret{"A": {Key: "A", Value: "a", Version: 1}}}
	l := local(map[string]store.Entry{})
	l.Deleted["A"] = 1
	Sync(context.Background(), f, api.Scope{}, l, "ask", true, nil)
	if _, ok := f.s["A"]; ok || len(l.Deleted) != 0 {
		t.Fatal("delete not pushed")
	}
}
