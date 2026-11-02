package vaultixpolicy

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func TestBuild_BoundsExpandedPolicy(t *testing.T) {
	actions := make([]string, 256)
	fields := make([]string, 1000)
	values := make([]any, 1000)
	for i := range actions {
		actions[i] = "read" + strconv.Itoa(i)
	}
	for i := range fields {
		fields[i] = "field" + strconv.Itoa(i)
		values[i] = i
	}
	for _, rule := range []JSONRule{
		{Action: actions, Subject: []string{"MockSubject"}, Conditions: Cond{"ID": Op{"$in": values}}},
		{Action: actions, Subject: []string{"MockSubject"}, Fields: fields},
	} {
		encoded, err := json.Marshal([]JSONRule{rule})
		if err != nil {
			t.Fatal(err)
		}
		if len(encoded) >= 64*1024 {
			t.Fatal("fixture must be compact enough to pass the input byte limit")
		}
		ability, err := LoadFromJSON(encoded, LoadOptions{})
		if err == nil || ability != nil {
			t.Fatal("compact JSON expanded beyond the complete policy construction budget")
		}
		if Can(ability, DefineAction[mockSubject]("read0"), mockSubject{ID: 1}) {
			t.Fatal("rejected expansion retained authority")
		}
	}
	ability, err := LoadFromJSON([]byte(`[{"action":"read","subject":"MockSubject","conditions":{"ID":1}}]`), LoadOptions{})
	if err != nil || !Can(ability, DefineAction[mockSubject]("read"), mockSubject{ID: 1}) || Can(ability, DefineAction[mockSubject]("read"), mockSubject{ID: 2}) {
		t.Fatal("bounded policy did not recover with its scope intact")
	}
}

func TestBuild_RejectsMalformedAuthorityAndRecovers(t *testing.T) {
	for _, conditions := range []string{
		`{"$or":[null]}`, `{"$and":[42]}`, `{"$not":false}`,
		`{"items":{"$elemMatch":"ignored"}}`, `{"items":{"$all":null}}`,
		`{"$unknown":true}`, `{"ID":{"$unknown":1}}`,
		`{"ID":{"$nin":["{{ .missing }}"]}}`,
	} {
		t.Run(conditions, func(t *testing.T) {
			policy, err := LoadFromJSON([]byte(`[{"action":"read","subject":"MockSubject","conditions":`+conditions+`}]`), LoadOptions{})
			if err == nil || policy != nil {
				t.Fatal("malformed policy produced authority")
			}
			if Can(policy, DefineAction[mockSubject]("read"), mockSubject{ID: 1}) {
				t.Fatal("failed load granted access")
			}
		})
	}
	policy, err := LoadFromJSON([]byte(`[{"action":"read","subject":"MockSubject","conditions":{"ID":1}}]`), LoadOptions{})
	if err != nil || !Can(policy, DefineAction[mockSubject]("read"), mockSubject{ID: 1}) || Can(policy, DefineAction[mockSubject]("read"), mockSubject{ID: 2}) {
		t.Fatal("valid policy did not recover with its scope intact")
	}
}

func TestBuild_SnapshotsInputsAndIntrospection(t *testing.T) {
	action := DefineAction[mockSubject]("read")
	allowed := []any{1}
	variables := map[string]any{"ids": allowed}
	conditions := Cond{"ID": Op{"$in": Var("ids")}}
	fields := []string{"Title"}
	ops := DefaultFieldOps()
	builder := NewAbility().WithVars(variables).WithFieldOps(ops)
	AddRule(builder, Allow(action).Where(conditions).OnFields(fields...).Build())
	ability, err := builder.Build()
	if err != nil {
		t.Fatal(err)
	}
	// Mutate all caller-owned inputs before the first (lazy) evaluation.
	allowed[0] = 2
	variables["ids"] = []any{3}
	conditions["ID"] = 2
	fields[0] = "ID"
	ops["$in"] = Compare(func(any, any) bool { return true })
	info := PossibleRulesFor(ability, action)
	info[0].Conditions["ID"] = 2
	info[0].Fields[0] = "ID"
	check := func() {
		if !Can(ability, action, mockSubject{ID: 1}) || Can(ability, action, mockSubject{ID: 2}) {
			t.Error("caller mutation changed authority")
		}
		if !CanWithField(ability, action, mockSubject{ID: 1}, "Title") || CanWithField(ability, action, mockSubject{ID: 1}, "ID") {
			t.Error("caller mutation changed field scope")
		}
	}
	var group sync.WaitGroup
	for range 32 {
		group.Go(check)
	}
	group.Wait()
	matched := RulesFor(ability, action, mockSubject{ID: 1})
	matched[0].Conditions["ID"] = 2
	matched[0].Fields[0] = "ID"
	check()
}

func TestBuild_BoundsAndRejectsCyclicInputs(t *testing.T) {
	cycle := Cond{}
	cycle["loop"] = cycle
	builder := NewAbility()
	AddRule(builder, Allow(DefineAction[mockSubject]("read")).Where(cycle).Build())
	if policy, err := builder.Build(); err == nil || policy != nil {
		t.Fatal("cyclic input accepted")
	}
	for _, payload := range []string{strings.Repeat(" ", DefaultMaxJSONSize+1) + `[]`, `[{"action":[],"subject":"MockSubject"}]`} {
		if policy, err := LoadFromJSON([]byte(payload), LoadOptions{}); err == nil || policy != nil {
			t.Fatal("invalid input accepted")
		}
	}
	if policy, err := LoadFromReader(strings.NewReader(`[]`+strings.Repeat(" ", 30)), LoadOptions{MaxSize: 10}); err == nil || policy != nil {
		t.Fatal("reader ignored size bound")
	}
}

func TestPolicy_CollectionEqualityAndNestedVariables(t *testing.T) {
	for _, scenario := range []struct {
		conditions string
		subject    MapSubject
		want       bool
	}{
		{`{"data":{"$eq":{"tenant":"a"}}}`, MapSubject{"data": map[string]any{"tenant": "a"}}, true},
		{`{"data":{"$eq":{"tenant":"a"}}}`, MapSubject{"data": map[string]any{"tenant": "b"}}, false},
		{`{"data":{}}`, MapSubject{"data": map[string]any{}}, true},
		{`{"data":{}}`, MapSubject{"data": "anything"}, false},
		{`{"data":{"$eq":["a","b"]}}`, MapSubject{"data": []any{"a", "b"}}, true},
		{`{"data":{"$in":["{{ .tenant }}"]}}`, MapSubject{"data": "a"}, true},
	} {
		var conditions Cond
		if err := json.Unmarshal([]byte(scenario.conditions), &conditions); err != nil {
			t.Fatal(err)
		}
		compiler := newCompiler(nil, nil, map[string]any{"tenant": "a"})
		if got := compiler.compile(processConditions(conditions))(scenario.subject); got != scenario.want {
			t.Errorf("%s: got %v", scenario.conditions, got)
		}
	}
}

func TestPolicy_AbsentAbilityDenies(t *testing.T) {
	action := DefineAction[mockSubject]("read")
	for _, ability := range []*Ability{nil, {}} {
		if Can(ability, action, mockSubject{}) || CanWithField(ability, action, mockSubject{}, "Title") || CanAny(ability, mockSubject{}, action) {
			t.Fatal("absent ability allowed")
		}
		if WhyNot(ability, action, mockSubject{}) == "" || len(RulesFor(ability, action, mockSubject{})) != 0 || len(PossibleRulesFor(ability, action)) != 0 {
			t.Fatal("absent ability introspection failed")
		}
	}
}

func TestDecodePackedRules_RejectsDroppedConstraints(t *testing.T) {
	for _, payload := range []string{
		`[["read","secrets","ignored"]]`, `[["read","secrets",0,"false"]]`,
		`[["read","secrets",0,0,42]]`, `[[["read",42],"secrets"]]`,
		`[["read","secrets",0,0,0,{},"extra"]]`,
	} {
		if rules, err := DecodePackedRules([]byte(payload)); err == nil || rules != nil {
			t.Fatalf("malformed tuple accepted: %s", payload)
		}
	}
	rules, err := DecodePackedRules([]byte(`[[["read","create"],["secrets"],{"environment":"dev"},true,["name"],"restricted"]]`))
	if err != nil || len(rules) != 1 || !rules[0].Inverted || len(rules[0].Action) != 2 || rules[0].Conditions["environment"] != "dev" || rules[0].Fields[0] != "name" {
		t.Fatal("stored rule contract changed")
	}
}
