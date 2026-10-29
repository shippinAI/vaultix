// Command vaultix keeps a local, encrypted copy of your Vaultix secrets in two-way sync and
// delivers them to application processes through `vaultix run`. AI uses the
// separate metadata-only MCP command, never application secret injection.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"time"

	"shippin.cloud/vaultix/internal/cli"
)

func usageText() string {
	name := cli.CommandName(os.Args[0])
	return `usage: ` + name + ` <command>
  login                         Nomen device-code login (browser link, no password)
  login --universal             machine identity: client id and secret on stdin
  login --token                 access token on stdin
  auth status                   verify protected Vaultix access without reading values
  logout                        forget local login (does not revoke issuer sessions)
  mcp                           authenticated metadata-only MCP over stdio
  mcp config                    print a token-free Codex configuration fragment
  init --project SLUG --env ENV [--path /] [--key-file F]
  pull [--on-conflict ask|local|remote]    server -> local
  push [--on-conflict ask|local|remote]    two-way; missing keys are created
  set KEY  (value on stdin)   rm KEY   ls (names only)
  run [--offline] -- CMD ARGS   pull, then run CMD with the secrets in its environment
  hook [bash|zsh]               print the pre-session pull snippet
  daemon [--every 5m]           two-way sync loop (conflicts left for you)

Install this binary as infisical to keep that command name. The API paths are unchanged.`
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := dispatch(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "vaultix:", err)
		os.Exit(1)
	}
}

func dispatch(ctx context.Context, a []string) error {
	if len(a) == 0 {
		return fmt.Errorf("%s", usageText())
	}
	cmd, rest := a[0], a[1:]
	switch cmd {
	case "login":
		return cli.Login(ctx, rest, os.Stdin, os.Stdout)
	case "logout":
		return cli.Logout()
	case "auth":
		if len(rest) == 1 && rest[0] == "status" {
			return cli.AuthStatus(ctx, os.Stdout)
		}
		return fmt.Errorf("usage: vaultix auth status")
	case "mcp":
		if len(rest) == 1 && rest[0] == "config" {
			return cli.MCPConfig(os.Stdout)
		}
		if len(rest) != 0 {
			return fmt.Errorf("usage: vaultix mcp [config]")
		}
		finished := make(chan struct{})
		defer close(finished)
		go func() {
			select {
			case <-ctx.Done():
				_ = os.Stdin.Close()
			case <-finished:
			}
		}()
		return cli.MCP(ctx, os.Stdin, os.Stdout)
	case "init":
		return cli.Init(rest, os.Stdout)
	case "pull", "push":
		return cli.Sync(ctx, rest, cmd == "push", os.Stdout)
	case "set", "rm":
		if len(rest) != 1 {
			return fmt.Errorf("usage: vaultix %s KEY", cmd)
		}
		if cmd == "set" {
			return cli.Set(rest[0], os.Stdin)
		}
		return cli.Remove(rest[0])
	case "ls":
		return cli.List(os.Stdout)
	case "run":
		offline := len(rest) > 0 && rest[0] == "--offline"
		if offline {
			rest = rest[1:]
		}
		if len(rest) > 0 && rest[0] == "--" {
			rest = rest[1:]
		}
		return cli.Run(ctx, rest, offline, os.Stderr)
	case "hook":
		sh := "bash"
		if len(rest) > 0 {
			sh = rest[0]
		}
		cli.Hook(sh, os.Stdout)
		return nil
	case "daemon":
		every := 5 * time.Minute
		if len(rest) == 2 && rest[0] == "--every" {
			d, err := time.ParseDuration(rest[1])
			if err != nil {
				return err
			}
			every = d
		}
		return cli.Daemon(ctx, every, os.Stdout)
	}
	return fmt.Errorf("unknown command %q\n%s", cmd, usageText())
}
