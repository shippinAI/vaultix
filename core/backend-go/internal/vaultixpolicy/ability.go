package vaultixpolicy

import (
	"fmt"
	"slices"
)

// AbilityBuilder builds an Ability instance.
type AbilityBuilder struct {
	fieldOps FieldOps
	condOps  CondOps
	vars     map[string]any
	rules    []rawRule
}

// rawRule is a type-erased representation of a Rule.
type rawRule struct {
	Action      string
	SubjectType string
	Inverted    bool
	Conditions  Cond
	Fields      []string
	Reason      string
}

// NewAbility creates a new AbilityBuilder with default operators.
func NewAbility() *AbilityBuilder {
	return &AbilityBuilder{
		fieldOps: defaultFieldOps(),
		condOps:  defaultCondOps(),
	}
}

// WithFieldOps sets the field operators to be used.
func (b *AbilityBuilder) WithFieldOps(ops FieldOps) *AbilityBuilder {
	b.fieldOps = ops
	return b
}

// WithCondOps sets the condition operators to be used.
func (b *AbilityBuilder) WithCondOps(ops CondOps) *AbilityBuilder {
	b.condOps = ops
	return b
}

// WithVars sets the template variables.
func (b *AbilityBuilder) WithVars(vars map[string]any) *AbilityBuilder {
	b.vars = vars
	return b
}

// AddRule adds a typed rule to the builder.
func AddRule[S Subject](b *AbilityBuilder, rule Rule[S]) *AbilityBuilder {
	var s S // zero value to get type
	b.rules = append(b.rules, rawRule{
		Action:      rule.Action.Name(),
		SubjectType: s.SubjectType(),
		Inverted:    rule.Inverted,
		Conditions:  rule.Conditions,
		Fields:      rule.Fields,
		Reason:      rule.Reason,
	})
	return b
}

// AddRules adds multiple typed rules.
func AddRules[S Subject](b *AbilityBuilder, rules ...Rule[S]) *AbilityBuilder {
	for _, r := range rules {
		AddRule(b, r)
	}
	return b
}

// Build creates the immutable Ability instance.
// It validates all rules, returning an error if any conditions reference
// unresolved template variables or unknown operators.
func (b *AbilityBuilder) Build() (*Ability, error) {
	if len(b.rules) > maxPolicyRules {
		return nil, fmt.Errorf("vaultix policy exceeds the rule limit")
	}
	vars, err := snapshotValue(b.vars)
	if err != nil {
		return nil, err
	}
	rules := make([]rawRule, len(b.rules))
	for i, rule := range b.rules {
		conditions, err := snapshotValue(rule.Conditions)
		if err != nil {
			return nil, fmt.Errorf("vaultix policy rule %d: %w", i, err)
		}
		var ok bool
		rule.Conditions, ok = conditions.(Cond)
		if !ok {
			return nil, fmt.Errorf("invalid internal policy condition snapshot")
		}
		rule.Fields = slices.Clone(rule.Fields)
		rules[i] = rule
	}
	variables, ok := vars.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid internal policy variable snapshot")
	}
	compiler := newCompiler(b.fieldOps, b.condOps, variables)

	if err := compiler.validate(rules); err != nil {
		return nil, err
	}

	index := newRuleIndex(rules, compiler)

	return &Ability{
		index:    index,
		compiler: compiler,
	}, nil
}

// Ability represents a set of permissions.
type Ability struct {
	index    *ruleIndex
	compiler *condCompiler
}
