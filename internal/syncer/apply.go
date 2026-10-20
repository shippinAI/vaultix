package syncer

import (
	"context"
	"fmt"

	"shippin.cloud/vaultix/internal/api"
	"shippin.cloud/vaultix/internal/store"
)

// Remote is the part of the API client sync needs.
type Remote interface {
	List(ctx context.Context, s api.Scope) ([]api.Secret, error)
	Put(ctx context.Context, s api.Scope, key, value string, create bool) (int, error)
	Delete(ctx context.Context, s api.Scope, key string) error
}

// Result counts what a sync did.
type Result struct{ Pulled, Pushed, Created, Deleted, Conflicts int }

// Sync runs one two-way pass. pushAllowed=false makes it pull-only (local edits stay dirty).
// ask is called for conflicts under PolicyAsk and returns true to keep the local value.
func Sync(ctx context.Context, r Remote, sc api.Scope, local *store.Scope, pol Policy, pushAllowed bool, ask func(key string) bool) (Result, error) {
	var res Result
	remote, err := r.List(ctx, sc)
	if err != nil {
		return res, err
	}
	for _, op := range Plan(local, remote) {
		kind := op.Kind
		if kind == "conflict" {
			res.Conflicts++
			if pol == "skip" {
				continue // leave both sides as they are (daemon mode)
			}
			keepLocal := pol == "local" || (pol == "ask" && ask != nil && ask(op.Key))
			switch {
			case keepLocal && op.Remote == nil:
				kind = "create"
			case keepLocal:
				if _, del := local.Deleted[op.Key]; del {
					kind = "delete-remote"
				} else {
					kind = "force-push"
				}
			case op.Remote == nil:
				kind = "delete-local"
			default:
				kind = "pull"
			}
		}
		if !pushAllowed && (kind == "push" || kind == "force-push" || kind == "create" || kind == "delete-remote") {
			continue
		}
		switch kind {
		case "pull":
			local.Entries[op.Key] = store.Entry{Value: op.Remote.Value, Base: op.Remote.Version}
			delete(local.Deleted, op.Key)
			res.Pulled++
		case "delete-local":
			delete(local.Entries, op.Key)
			res.Deleted++
		case "push", "force-push", "create":
			e := local.Entries[op.Key]
			v, err := r.Put(ctx, sc, op.Key, e.Value, kind == "create")
			if err != nil {
				return res, fmt.Errorf("%s %s: %w", kind, op.Key, err)
			}
			local.Entries[op.Key] = store.Entry{Value: e.Value, Base: v}
			if kind == "create" {
				res.Created++
			} else {
				res.Pushed++
			}
		case "delete-remote":
			if err := r.Delete(ctx, sc, op.Key); err != nil && !api.NotFound(err) {
				return res, fmt.Errorf("delete %s: %w", op.Key, err)
			}
			delete(local.Deleted, op.Key)
			res.Deleted++
		}
	}
	return res, nil
}
