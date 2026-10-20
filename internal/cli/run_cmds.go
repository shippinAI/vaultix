package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"

	"shippin.cloud/vaultix/internal/store"
)

// Run pulls (unless offline or the server is unreachable, then it uses the local copy), then
// runs argv with the scope's secrets added to its environment. Values never touch argv.
func Run(ctx context.Context, argv []string, offline bool, errOut io.Writer) error {
	if len(argv) == 0 {
		return fmt.Errorf("usage: vaultix run [--offline] -- command [args]")
	}
	if !offline {
		if err := Sync(ctx, []string{"--on-conflict=local"}, false, io.Discard); err != nil {
			fmt.Fprintf(errOut, "vaultix: pull failed, using the local copy: %v\n", err)
		}
	}
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	key, err := store.DataKey(cfg.KeyFile)
	if err != nil {
		return err
	}
	sc, err := (&store.Store{Dir: Dir(), Key: key}).Load(cfg.scopeName())
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = os.Environ()
	for k, e := range sc.Entries {
		cmd.Env = append(cmd.Env, k+"="+e.Value)
	}
	return cmd.Run()
}

// Hook prints the shell snippet that pulls before each new interactive session.
func Hook(shell string, out io.Writer) {
	fmt.Fprintf(out, "# vaultix pre-session pull (%s): add to your rc file\ncommand -v vaultix >/dev/null && vaultix pull --on-conflict=local >/dev/null 2>&1 &\n", shell)
}

// Daemon syncs both ways every interval until ctx ends; conflicts keep both sides untouched
// (policy "remote" would discard local edits, so the daemon never resolves them silently).
func Daemon(ctx context.Context, every time.Duration, out io.Writer) error {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if err := Sync(ctx, []string{"--on-conflict=skip"}, true, out); err != nil {
			fmt.Fprintf(out, "vaultix daemon: %v\n", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
	}
}
