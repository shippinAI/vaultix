package vaultixpolicy

import (
	"fmt"
	"reflect"
)

const maxPolicyDepth = 64
const maxPolicyNodes = 100000
const maxPolicyRules = 16384

// A built policy must not retain maps or slices owned by a request or caller.
// Depth and node bounds also reject cycles without recursively exhausting the process.
func snapshotValue(value any) (any, error) {
	remaining := maxPolicyNodes
	return snapshotWithinBudget(value, &remaining)
}

func snapshotWithinBudget(value any, remaining *int) (any, error) {
	copied, err := copyPolicyValue(reflect.ValueOf(value), 0, remaining)
	if err != nil || !copied.IsValid() {
		return nil, err
	}
	return copied.Interface(), nil
}

func copyPolicyValue(value reflect.Value, depth int, remaining *int) (reflect.Value, error) {
	*remaining--
	if depth > maxPolicyDepth || *remaining < 0 {
		return reflect.Value{}, fmt.Errorf("vaultix policy exceeds structural limits")
	}
	if !value.IsValid() {
		return value, nil
	}
	switch value.Kind() {
	case reflect.Interface:
		if value.IsNil() {
			return reflect.Zero(value.Type()), nil
		}
		child, err := copyPolicyValue(value.Elem(), depth+1, remaining)
		if err != nil {
			return reflect.Value{}, err
		}
		result := reflect.New(value.Type()).Elem()
		result.Set(child)
		return result, nil
	case reflect.Map:
		if value.Type().Key().Kind() != reflect.String {
			return reflect.Value{}, fmt.Errorf("vaultix policy maps require string keys")
		}
		if value.IsNil() {
			return reflect.Zero(value.Type()), nil
		}
		if value.Len() > *remaining {
			return reflect.Value{}, fmt.Errorf("vaultix policy exceeds structural limits")
		}
		result := reflect.MakeMapWithSize(value.Type(), value.Len())
		iterator := value.MapRange()
		for iterator.Next() {
			child, err := copyPolicyValue(iterator.Value(), depth+1, remaining)
			if err != nil {
				return reflect.Value{}, err
			}
			result.SetMapIndex(iterator.Key(), child)
		}
		return result, nil
	case reflect.Slice, reflect.Array:
		if value.Len() > *remaining {
			return reflect.Value{}, fmt.Errorf("vaultix policy exceeds structural limits")
		}
		var result reflect.Value
		if value.Kind() == reflect.Slice {
			if value.IsNil() {
				return reflect.Zero(value.Type()), nil
			}
			result = reflect.MakeSlice(value.Type(), value.Len(), value.Len())
		} else {
			result = reflect.New(value.Type()).Elem()
		}
		for i := range value.Len() {
			child, err := copyPolicyValue(value.Index(i), depth+1, remaining)
			if err != nil {
				return reflect.Value{}, err
			}
			result.Index(i).Set(child)
		}
		return result, nil
	case reflect.Bool, reflect.String, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64:
		return value, nil
	default:
		return reflect.Value{}, fmt.Errorf("unsupported Vaultix policy value type %s", value.Kind())
	}
}

func copyConditions(conditions Cond) Cond {
	copied, err := snapshotValue(conditions)
	if err != nil {
		// Internal conditions have already passed the same snapshot bounds at Build.
		panic("invalid internal Vaultix policy snapshot")
	}
	result, ok := copied.(Cond)
	if !ok {
		panic("invalid internal Vaultix policy condition type")
	}
	return result
}
