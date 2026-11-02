package vaultixpolicy

import (
	"encoding/json"
	"fmt"
)

// DecodePackedRules validates persisted tuples before interpreting omitted slots.
// A malformed constraint must never be dropped and become an unconditional grant.
func DecodePackedRules(data []byte) ([]JSONRule, error) {
	if len(data) > DefaultMaxJSONSize {
		return nil, fmt.Errorf("vaultix packed policy exceeds maximum size")
	}
	var packed []PackedRule
	if err := json.Unmarshal(data, &packed); err != nil {
		return nil, fmt.Errorf("invalid Vaultix packed policy JSON")
	}
	if len(packed) > maxPolicyRules {
		return nil, fmt.Errorf("vaultix packed policy exceeds rule limit")
	}
	for index, tuple := range packed {
		invalid := func() ([]JSONRule, error) { return nil, fmt.Errorf("invalid Vaultix packed policy rule %d", index) }
		if len(tuple) < 2 || len(tuple) > 6 || !packedNames(tuple[0]) || !packedNames(tuple[1]) {
			return invalid()
		}
		if len(tuple) > 2 && !packedEmpty(tuple[2]) {
			if _, ok := tuple[2].(map[string]any); !ok {
				return invalid()
			}
		}
		if len(tuple) > 3 && !packedEmpty(tuple[3]) && tuple[3] != true && tuple[3] != float64(1) {
			return invalid()
		}
		if len(tuple) > 4 && !packedEmpty(tuple[4]) && !packedNames(tuple[4]) {
			return invalid()
		}
		if len(tuple) > 5 && tuple[5] != nil {
			if _, ok := tuple[5].(string); !ok {
				return invalid()
			}
		}
	}
	return UnpackRules(packed), nil
}

func packedEmpty(value any) bool {
	return value == nil || value == float64(0) || value == false || value == ""
}

func packedNames(value any) bool {
	switch value := value.(type) {
	case string:
		return value != ""
	case []any:
		if len(value) == 0 {
			return false
		}
		for _, item := range value {
			name, ok := item.(string)
			if !ok || name == "" {
				return false
			}
		}
		return true
	default:
		return false
	}
}
