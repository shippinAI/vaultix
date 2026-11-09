package permission

import (
	"reflect"
	"strings"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/vaultix/api/internal/vaultixpolicy"
)

// opGlob implements the $glob operator for path matching.
// Port of the picomatch-based $glob from Node.js (backend/src/lib/casl/index.ts).
// Uses doublestar for glob matching which supports ** patterns like picomatch.
func opGlob(fieldValue, constraint any) bool {
	val, ok := fieldValue.(string)
	pattern, ok2 := constraint.(string)
	if !ok || !ok2 {
		return false
	}

	if strings.TrimSpace(pattern) == "" {
		return false
	}

	// doublestar.Match handles *, **, ?, and character classes.
	matched, err := doublestar.Match(pattern, val)
	if err != nil {
		return false
	}

	return matched
}

// arrayMembership matches each field element against the candidate list, as
// the application's CASL matcher does. Negation applies to the whole match:
// one excluded tag must make $nin false even when other tags are allowed.
func arrayMembership(base vaultixpolicy.FieldOp, negate bool) vaultixpolicy.FieldOp {
	return vaultixpolicy.FieldOp{
		Validate: base.Validate,
		Compile: func(cc *vaultixpolicy.CompileCtx, field string, constraint any) vaultixpolicy.Condition {
			contains := base.Compile(cc, field, constraint)
			return func(subject vaultixpolicy.Subject) bool {
				value := reflect.ValueOf(subject.GetField(field))
				matched := false
				if value.IsValid() && (value.Kind() == reflect.Slice || value.Kind() == reflect.Array) {
					for i := 0; i < value.Len(); i++ {
						if contains(vaultixpolicy.MapSubject{field: value.Index(i).Interface()}) {
							matched = true
							break
						}
					}
				} else {
					matched = contains(subject)
				}
				return matched != negate
			}
		},
	}
}

// arrayContainsAll matches CASL/Mongo $all on a tag list: every candidate is
// present in the field array. An empty candidate list matches. A non-array
// field does not. This is not the vendored "every element matches a nested
// condition" operator.
func arrayContainsAll(eq vaultixpolicy.FieldOp) vaultixpolicy.FieldOp {
	return vaultixpolicy.FieldOp{
		Compile: func(cc *vaultixpolicy.CompileCtx, field string, constraint any) vaultixpolicy.Condition {
			list := reflect.ValueOf(constraint)
			if !list.IsValid() || (list.Kind() != reflect.Slice && list.Kind() != reflect.Array) {
				return func(vaultixpolicy.Subject) bool { return false }
			}
			checks := make([]vaultixpolicy.Condition, 0, list.Len())
			for i := 0; i < list.Len(); i++ {
				checks = append(checks, eq.Compile(cc, field, list.Index(i).Interface()))
			}
			return func(subject vaultixpolicy.Subject) bool {
				if len(checks) == 0 {
					return true
				}
				value := reflect.ValueOf(subject.GetField(field))
				if !value.IsValid() || (value.Kind() != reflect.Slice && value.Kind() != reflect.Array) {
					return false
				}
				for _, check := range checks {
					found := false
					for i := 0; i < value.Len(); i++ {
						if check(vaultixpolicy.MapSubject{field: value.Index(i).Interface()}) {
							found = true
							break
						}
					}
					if !found {
						return false
					}
				}
				return true
			}
		},
	}
}

// PermissionFieldOps adds the product's path and array membership semantics.
func PermissionFieldOps() vaultixpolicy.FieldOps {
	ops := vaultixpolicy.DefaultFieldOps()
	return ops.With("$glob", vaultixpolicy.Compare(opGlob)).
		With("$in", arrayMembership(ops["$in"], false)).
		With("$nin", arrayMembership(ops["$in"], true)).
		With("$all", arrayContainsAll(ops["$eq"]))
}
