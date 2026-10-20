package cli

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"shippin.cloud/vaultix/internal/store"
	"shippin.cloud/vaultix/internal/syncer"
)

// Sync pulls (and with push=true, pushes) the configured scope.
func Sync(ctx context.Context, args []string, push bool, out io.Writer) error {
	fs := flag.NewFlagSet("sync", flag.ContinueOnError)
	pol := fs.String("on-conflict", "ask", "ask | local | remote")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	s, err := open(ctx, cfg)
	if err != nil {
		return err
	}
	local, err := s.st.Load(cfg.scopeName())
	if err != nil {
		return err
	}
	res, err := syncer.Sync(ctx, s.c, s.scope, local, syncer.Policy(*pol), push, ask)
	if serr := s.st.Save(cfg.scopeName(), local); err == nil {
		err = serr
	}
	fmt.Fprintf(out, "pulled %d, pushed %d, created %d, deleted %d, conflicts %d\n", res.Pulled, res.Pushed, res.Created, res.Deleted, res.Conflicts)
	return err
}

func ask(key string) bool {
	fmt.Fprintf(os.Stderr, "%s changed here and on the server. Keep the local value? [y/N] ", key)
	l, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(l)), "y")
}

// Set stages a local value read from stdin (pushed, and auto-created if missing, on next push).
func Set(key string, stdin io.Reader) error {
	b, err := io.ReadAll(io.LimitReader(stdin, 1<<20))
	if err != nil {
		return err
	}
	return edit(func(sc *store.Scope) {
		e := sc.Entries[key]
		e.Value, e.Dirty = strings.TrimRight(string(b), "\r\n"), true
		sc.Entries[key] = e
		delete(sc.Deleted, key)
	})
}

// Remove stages a local delete.
func Remove(key string) error {
	return edit(func(sc *store.Scope) {
		if e, ok := sc.Entries[key]; ok {
			if e.Base > 0 {
				sc.Deleted[key] = e.Base
			}
			delete(sc.Entries, key)
		}
	})
}

// List prints key names (never values) with a * for unpushed changes.
func List(out io.Writer) error {
	return edit(func(sc *store.Scope) {
		keys := make([]string, 0, len(sc.Entries))
		for k := range sc.Entries {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			mark := ""
			if sc.Entries[k].Dirty {
				mark = " *"
			}
			fmt.Fprintln(out, k+mark)
		}
	})
}

func edit(f func(*store.Scope)) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	key, err := store.DataKey(cfg.KeyFile)
	if err != nil {
		return err
	}
	st := &store.Store{Dir: Dir(), Key: key}
	sc, err := st.Load(cfg.scopeName())
	if err != nil {
		return err
	}
	f(sc)
	return st.Save(cfg.scopeName(), sc)
}
