package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"shippin.cloud/vaultix/internal/platform"
)

const serverUsage = `usage: vaultix server <install|adopt|upgrade|status|recover|rollback> --directory DIR
  install --from-build RECEIPT --site-url https://vaultix.example.com
          [--project vaultix] [--port 8200] [--env-file PRIVATE_FILE] [--plan]
  adopt --env-file EXISTING_PRIVATE_FILE --project EXISTING_PROJECT
        --site-url https://vaultix.example.com [--port 8200]
  upgrade --from-build RECEIPT [--plan]
  upgrade --bundle DIRECTORY --trust FILE [--plan]
  upgrade --apply OPERATION_ID
  recover                  resume the saved operation and artifact
  rollback [--discard-writes]
                           return to the previous application; a changed schema
                           is restored from the upgrade's checkpoint
  status                   inspect saved state and actual application health
  --json                   JSON result without progress output

Install also accepts --bundle DIRECTORY --trust FILE. The Docker engine must be
Linux/amd64 with Compose v2. Keys and operation state stay in the private instance
directory. Existing deployments are adopted explicitly. Upgrades preserve data
volumes. A changed migration set is rehearsed on a restored copy with no network
before the live database is touched. --discard-writes accepts losing writes made
since the checkpoint, and is required whenever rollback restores the database.`

func serverCommand(ctx context.Context, args []string, out, progress io.Writer) error {
	if len(args) == 0 {
		return errors.New(serverUsage)
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "help") {
		_, err := fmt.Fprintln(out, serverUsage)
		return err
	}
	fs := flag.NewFlagSet("server", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var o platform.Options
	var asJSON bool
	fs.StringVar(&o.Directory, "directory", "", "private instance directory")
	fs.StringVar(&o.Project, "project", "vaultix", "Compose project")
	fs.StringVar(&o.SiteURL, "site-url", "", "public application origin")
	fs.IntVar(&o.Port, "port", 8200, "loopback application port")
	fs.StringVar(&o.BuildReceipt, "from-build", "", "canonical build receipt")
	fs.StringVar(&o.Bundle, "bundle", "", "verified release bundle directory")
	fs.StringVar(&o.Trust, "trust", "", "preprovisioned trust file")
	fs.StringVar(&o.Environment, "env-file", "", "existing private environment file")
	fs.StringVar(&o.Apply, "apply", "", "saved operation ID")
	fs.BoolVar(&o.Plan, "plan", false, "save a reviewable operation without cutover")
	fs.BoolVar(&o.DiscardWrites, "discard-writes", false, "accept losing writes made since the upgrade's checkpoint")
	fs.BoolVar(&asJSON, "json", false, "machine-readable result")
	if err := fs.Parse(args[1:]); errors.Is(err, flag.ErrHelp) {
		_, err = fmt.Fprintln(out, serverUsage)
		return err
	} else if err != nil || fs.NArg() != 0 {
		return errors.New(serverUsage)
	}
	if asJSON {
		progress = io.Discard
	}
	ctx, cancel := context.WithTimeout(ctx, 35*time.Minute)
	defer cancel()
	result, err := platform.Execute(ctx, args[0], o, progress)
	if result.Operation != nil {
		if encodeErr := json.NewEncoder(out).Encode(result); encodeErr != nil {
			return encodeErr
		}
	}
	return err
}
