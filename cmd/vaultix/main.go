// Command vaultix keeps a local, encrypted copy of your Vaultix secrets in two-way sync and
// delivers them to application processes through `vaultix run`. AI uses the
// separate metadata-only MCP command, never application secret injection.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"time"

	"shippin.cloud/vaultix/internal/cli"
	"shippin.cloud/vaultix/internal/release"
)

func usageText() string {
	name := cli.CommandName(os.Args[0])
	return `usage: ` + name + ` <command>
  version [--json]              show the installed CLI build
  update check [--json]         check the stable Vaultix release channel
  update verify --bundle DIR --trust FILE [--checkpoint FILE]  verify a signed release without installing
  update download --version VERSION --directory DIR --trust FILE  download a verified release bundle
  update install --directory DIR (--version VERSION | --bundle DIR) [--trust FILE]  install/update managed Linux CLI
  update status --directory DIR  verify the installed native pair and accepted release
  server install|adopt|upgrade|status|recover  manage a self-hosted instance
  login --domain=https://vaultix.cloud   select a Vaultix instance and sign in
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
  run -- CMD ARGS               require a successful pull, then run CMD with secrets
  run --offline -- CMD ARGS     use cached secrets without checking server access
  hook [bash|zsh]               print the pre-session pull snippet
  daemon [--every 5m]           two-way sync loop (conflicts left for you)

Native executable names: vaultix and vaultixl. Existing --api login scripts remain supported.`
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	args := commandArguments(os.Args)
	if err := dispatch(ctx, args); err != nil {
		fmt.Fprintln(os.Stderr, cli.CommandName(os.Args[0])+":", err)
		os.Exit(1)
	}
	release.Notify(ctx, version, args, os.Stderr)
}

func dispatch(ctx context.Context, a []string) error {
	if len(a) == 0 {
		return fmt.Errorf("%s", usageText())
	}
	cmd, rest := a[0], a[1:]
	switch cmd {
	case "--help", "-h", "help":
		fmt.Fprintln(os.Stdout, usageText())
		return nil
	case "version", "--version":
		return printVersion(rest, os.Stdout)
	case "update":
		return checkUpdate(ctx, rest, os.Stdout)
	case "server":
		return serverCommand(ctx, rest, os.Stdout, os.Stderr)
	case "login":
		err := cli.Login(ctx, rest, os.Stdin, os.Stdout)
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
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
