package vaultixpolicy

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

func TestPackUnpack(t *testing.T) {
	tests := []struct {
		name     string
		input    []JSONRule
		expected []PackedRule // Expected packed structure
	}{
		{
			name: "Basic Rule",
			input: []JSONRule{
				{Action: []string{"read"}, Subject: []string{"Post"}},
			},
			expected: []PackedRule{
				{"read", "Post"},
			},
		},
		{
			name: "Rule with Conditions",
			input: []JSONRule{
				{
					Action:     []string{"read"},
					Subject:    []string{"Post"},
					Conditions: Cond{"published": true},
				},
			},
			expected: []PackedRule{
				{"read", "Post", Cond{"published": true}},
			},
		},
		{
			name: "Inverted Rule",
			input: []JSONRule{
				{
					Action:   []string{"delete"},
					Subject:  []string{"Post"},
					Inverted: true,
				},
			},
			expected: []PackedRule{
				{"delete", "Post", 0, 1},
			},
		},
		{
			name: "Rule with Fields",
			input: []JSONRule{
				{
					Action:  []string{"update"},
					Subject: []string{"Post"},
					Fields:  []string{"title", "body"},
				},
			},
			expected: []PackedRule{
				{"update", "Post", 0, 0, "title,body"},
			},
		},
		{
			name: "Rule with Reason",
			input: []JSONRule{
				{
					Action:   []string{"delete"},
					Subject:  []string{"Post"},
					Inverted: true,
					Reason:   "Not allowed",
				},
			},
			expected: []PackedRule{
				{"delete", "Post", 0, 1, 0, "Not allowed"},
			},
		},
		{
			name: "Complex Rule",
			input: []JSONRule{
				{
					Action:     []string{"manage"},
					Subject:    []string{"all"},
					Conditions: Cond{"orgId": 1},
					Inverted:   true,
					Fields:     []string{"id"},
					Reason:     "Root",
				},
			},
			expected: []PackedRule{
				{"manage", "all", Cond{"orgId": 1}, 1, "id", "Root"},
			},
		},
		{
			name: "Multiple Actions and Subjects",
			input: []JSONRule{
				{
					Action:  []string{"read", "update"},
					Subject: []string{"Post", "Comment"},
				},
			},
			expected: []PackedRule{
				{"read,update", "Post,Comment"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Test Pack
			packed := PackRules(tt.input)
			if !reflect.DeepEqual(packed, tt.expected) {
				t.Errorf("PackRules() = %v, want %v", packed, tt.expected)
			}

			// Test Unpack
			unpacked := UnpackRules(packed)
			if !reflect.DeepEqual(unpacked, tt.input) {
				// DeepEqual is strict about nil vs empty slice.
				// Let's check manually if strict equality fails.
				if len(unpacked) != len(tt.input) {
					t.Errorf("UnpackRules() length = %d, want %d", len(unpacked), len(tt.input))
				} else {
					for i := range unpacked {
						if !rulesEqual(&unpacked[i], &tt.input[i]) {
							t.Errorf("UnpackRules()[%d] = %+v, want %+v", i, unpacked[i], tt.input[i])
						}
					}
				}
			}

			// Test JSON Serialization Round Trip
			encoded, err := json.Marshal(packed)
			if err != nil {
				t.Fatalf("Failed to marshal packed: %v", err)
			}

			var unmarshaledPacked []PackedRule
			if err := json.Unmarshal(encoded, &unmarshaledPacked); err != nil {
				t.Fatalf("Failed to unmarshal packed: %v", err)
			}

			// Compare the complete JSON representation, including every condition and field.
			// JSON normalization treats the expected integer and decoded float equally.
			finalUnpacked := UnpackRules(unmarshaledPacked)
			actualJSON, err := json.Marshal(finalUnpacked)
			if err != nil {
				t.Fatal(err)
			}
			expectedJSON, err := json.Marshal(tt.input)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(actualJSON, expectedJSON) {
				t.Errorf("RoundTrip = %s, want %s", actualJSON, expectedJSON)
			}
		})
	}
}

// rulesEqual checks if two JSONRules are effectively equal, handling nil vs empty slice
func rulesEqual(a, b *JSONRule) bool {
	if !slicesEqual(a.Action, b.Action) {
		return false
	}
	if !slicesEqual(a.Subject, b.Subject) {
		return false
	}
	if !slicesEqual(a.Fields, b.Fields) {
		return false
	}
	if a.Inverted != b.Inverted {
		return false
	}
	if a.Reason != b.Reason {
		return false
	}
	return (len(a.Conditions) == 0 && len(b.Conditions) == 0) || reflect.DeepEqual(a.Conditions, b.Conditions)
}

func slicesEqual(a, b []string) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	return reflect.DeepEqual(a, b)
}

// TestUnpackRulesFromNodeJS tests unpacking rules produced by Node.js CASL packRules,
// where actions/subjects are arrays ([]any) and inverted is a bool.
func TestUnpackRulesFromNodeJS(t *testing.T) {
	tests := []struct {
		name     string
		packed   []PackedRule
		expected []JSONRule
	}{
		{
			name: "Array actions and subjects",
			packed: []PackedRule{
				{[]any{"read", "create"}, []any{"Post", "Comment"}},
			},
			expected: []JSONRule{
				{Action: []string{"read", "create"}, Subject: []string{"Post", "Comment"}},
			},
		},
		{
			name: "Single-element arrays",
			packed: []PackedRule{
				{[]any{"read"}, []any{"Post"}},
			},
			expected: []JSONRule{
				{Action: []string{"read"}, Subject: []string{"Post"}},
			},
		},
		{
			name: "Bool inverted true",
			packed: []PackedRule{
				{[]any{"delete"}, []any{"Post"}, 0, true},
			},
			expected: []JSONRule{
				{Action: []string{"delete"}, Subject: []string{"Post"}, Inverted: true},
			},
		},
		{
			name: "Bool inverted false",
			packed: []PackedRule{
				{[]any{"read"}, []any{"Post"}, 0, false},
			},
			expected: []JSONRule{
				{Action: []string{"read"}, Subject: []string{"Post"}, Inverted: false},
			},
		},
		{
			name: "Array fields",
			packed: []PackedRule{
				{[]any{"update"}, []any{"Post"}, 0, 0, []any{"title", "body"}},
			},
			expected: []JSONRule{
				{Action: []string{"update"}, Subject: []string{"Post"}, Fields: []string{"title", "body"}},
			},
		},
		{
			name: "Full Node.js rule with arrays and bool",
			packed: []PackedRule{
				{[]any{"manage"}, []any{"all"}, map[string]any{"orgId": float64(1)}, true, []any{"id"}, "Root"},
			},
			expected: []JSONRule{
				{
					Action:     []string{"manage"},
					Subject:    []string{"all"},
					Conditions: Cond{"orgId": float64(1)},
					Inverted:   true,
					Fields:     []string{"id"},
					Reason:     "Root",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			unpacked := UnpackRules(tt.packed)
			if len(unpacked) != len(tt.expected) {
				t.Fatalf("length = %d, want %d", len(unpacked), len(tt.expected))
			}
			for i := range unpacked {
				if !rulesEqual(&unpacked[i], &tt.expected[i]) {
					t.Errorf("rule[%d] = %+v, want %+v", i, unpacked[i], tt.expected[i])
				}
			}
		})
	}
}

// TestUnpackRulesFromJSON tests the full JSON unmarshal -> unpack path,
// simulating data received from a Node.js CASL service.
func TestUnpackRulesFromJSON(t *testing.T) {
	tests := []struct {
		name     string
		json     string
		expected []JSONRule
	}{
		{
			name: "Node.js format with arrays",
			json: `[["read","Post"],["update","Comment"]]`,
			expected: []JSONRule{
				{Action: []string{"read"}, Subject: []string{"Post"}},
				{Action: []string{"update"}, Subject: []string{"Comment"}},
			},
		},
		{
			name: "Node.js format with array actions/subjects",
			json: `[[["read","create"],["Post","Comment"]]]`,
			expected: []JSONRule{
				{Action: []string{"read", "create"}, Subject: []string{"Post", "Comment"}},
			},
		},
		{
			name: "Node.js inverted as bool true",
			json: `[["delete","Post",0,true]]`,
			expected: []JSONRule{
				{Action: []string{"delete"}, Subject: []string{"Post"}, Inverted: true},
			},
		},
		{
			name: "Go format with comma-joined strings",
			json: `[["read,create","Post,Comment"]]`,
			expected: []JSONRule{
				{Action: []string{"read", "create"}, Subject: []string{"Post", "Comment"}},
			},
		},
		{
			name: "Inverted as number 1 (via JSON)",
			json: `[["delete","Post",0,1]]`,
			expected: []JSONRule{
				{Action: []string{"delete"}, Subject: []string{"Post"}, Inverted: true},
			},
		},
		{
			name: "Full rule from Node.js",
			json: `[[["manage"],["all"],{"orgId":1},true,["id"],"Root"]]`,
			expected: []JSONRule{
				{
					Action:     []string{"manage"},
					Subject:    []string{"all"},
					Conditions: Cond{"orgId": float64(1)},
					Inverted:   true,
					Fields:     []string{"id"},
					Reason:     "Root",
				},
			},
		},
		{
			name: "Mixed rules from different sources",
			json: `[["read","Post"],[["read","create"],["Post","Comment"],0,true]]`,
			expected: []JSONRule{
				{Action: []string{"read"}, Subject: []string{"Post"}},
				{Action: []string{"read", "create"}, Subject: []string{"Post", "Comment"}, Inverted: true},
			},
		},
		{
			name:     "Empty packed rules",
			json:     `[]`,
			expected: []JSONRule{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var packed []PackedRule
			if err := json.Unmarshal([]byte(tt.json), &packed); err != nil {
				t.Fatalf("failed to unmarshal JSON: %v", err)
			}

			unpacked := UnpackRules(packed)
			if len(unpacked) != len(tt.expected) {
				t.Fatalf("length = %d, want %d", len(unpacked), len(tt.expected))
			}
			for i := range unpacked {
				if !rulesEqual(&unpacked[i], &tt.expected[i]) {
					t.Errorf("rule[%d] = %+v, want %+v", i, unpacked[i], tt.expected[i])
				}
			}
		})
	}
}
