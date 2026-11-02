package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"shippin.cloud/vaultix/internal/release"
)

const downloadUsage = "usage: vaultix update download --version SEMVER --directory NEW_DIRECTORY --trust FILE [--checkpoint FILE] [--preview] [--json]"

func downloadRelease(ctx context.Context, args []string, out, progress io.Writer) error {
	fs := flag.NewFlagSet("update download", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var o release.DownloadOptions
	var asJSON bool
	fs.StringVar(&o.Version, "version", "", "exact version without v prefix")
	fs.StringVar(&o.Directory, "directory", "", "new bundle directory under an existing trusted parent")
	fs.StringVar(&o.Trust, "trust", "", "preprovisioned public release trust")
	fs.StringVar(&o.Checkpoint, "checkpoint", "", "previous accepted release checkpoint")
	fs.BoolVar(&o.Preview, "preview", false, "explicitly select a prerelease")
	fs.BoolVar(&asJSON, "json", false, "omit progress from stderr")
	if err := fs.Parse(args); errors.Is(err, flag.ErrHelp) {
		_, err = fmt.Fprintln(out, downloadUsage)
		return err
	} else if err != nil || fs.NArg() != 0 || o.Version == "" || o.Directory == "" || o.Trust == "" {
		return errors.New(downloadUsage)
	}
	if !asJSON {
		o.Progress = progress
	}
	ctx, cancel := context.WithTimeout(ctx, time.Hour)
	defer cancel()
	result, err := release.Download(ctx, o)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}
