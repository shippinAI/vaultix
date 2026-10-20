// Package syncer reconciles the local store with the server: per-key versions decide, and a
// key changed on both sides since the last sync is a conflict resolved by policy or prompt.
package syncer

import (
	"sort"

	"shippin.cloud/vaultix/internal/api"
	"shippin.cloud/vaultix/internal/store"
)

// Policy resolves conflicts: "ask" (prompt), "local", "remote" or "skip" (leave unresolved).
type Policy string

// Op is one planned change.
type Op struct {
	Key    string
	Kind   string // "pull", "push", "create", "delete-remote", "delete-local", "conflict"
	Remote *api.Secret
}

// Plan compares local state with the remote listing and returns the operations, sorted by key.
func Plan(local *store.Scope, remote []api.Secret) []Op {
	rm := map[string]api.Secret{}
	for _, s := range remote {
		rm[s.Key] = s
	}
	var ops []Op
	for k, e := range local.Entries {
		r, ok := rm[k]
		switch {
		case !ok && e.Base == 0:
			ops = append(ops, Op{Key: k, Kind: "create"}) // new locally: auto-create remotely
		case !ok && e.Dirty:
			ops = append(ops, Op{Key: k, Kind: "conflict"}) // edited here, deleted there
		case !ok:
			ops = append(ops, Op{Key: k, Kind: "delete-local"})
		case r.Version == e.Base && e.Dirty:
			ops = append(ops, Op{Key: k, Kind: "push", Remote: &r})
		case r.Version != e.Base && e.Dirty:
			ops = append(ops, Op{Key: k, Kind: "conflict", Remote: &r})
		case r.Version != e.Base || r.Value != e.Value:
			ops = append(ops, Op{Key: k, Kind: "pull", Remote: &r})
		}
	}
	for k, base := range local.Deleted {
		if r, ok := rm[k]; ok {
			if r.Version == base {
				ops = append(ops, Op{Key: k, Kind: "delete-remote", Remote: &r})
			} else {
				ops = append(ops, Op{Key: k, Kind: "conflict", Remote: &r})
			}
		}
	}
	for k, r := range rm {
		if _, ok := local.Entries[k]; !ok {
			if _, del := local.Deleted[k]; !del {
				r := r
				ops = append(ops, Op{Key: k, Kind: "pull", Remote: &r})
			}
		}
	}
	sort.Slice(ops, func(i, j int) bool { return ops[i].Key < ops[j].Key })
	return ops
}
