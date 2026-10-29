package permission

import (
	"reflect"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/vaultix/gocasl"
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
func arrayMembership(base gocasl.FieldOp, negate bool) gocasl.FieldOp {
	return gocasl.FieldOp{
		Validate: base.Validate,
		Compile: func(cc *gocasl.CompileCtx, field string, constraint any) gocasl.Condition {
			contains := base.Compile(cc, field, constraint)
			return func(subject gocasl.Subject) bool {
				value := reflect.ValueOf(subject.GetField(field))
				matched := false
				if value.IsValid() && (value.Kind() == reflect.Slice || value.Kind() == reflect.Array) {
					for i := 0; i < value.Len(); i++ {
						if contains(gocasl.MapSubject{field: value.Index(i).Interface()}) {
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

// PermissionFieldOps adds the product's path and array membership semantics.
func PermissionFieldOps() gocasl.FieldOps {
	ops := gocasl.DefaultFieldOps()
	return ops.With("$glob", gocasl.Compare(opGlob)).
		With("$in", arrayMembership(ops["$in"], false)).
		With("$nin", arrayMembership(ops["$in"], true))
}
