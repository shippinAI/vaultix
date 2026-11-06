package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"runtime"
	"shippin.cloud/vaultix/internal/release"
	"time"
)

const installUsage = "usage: vaultix update install [--directory DIR] (--version SEMVER | --bundle DIR) [--trust FILE] [--preview] [--json] (directory is required on Linux; Windows uses its per-user application directory)"

func installRelease(ctx context.Context, args []string, out, progress io.Writer) error {
	fs := flag.NewFlagSet("update install", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var o release.CLIInstallOptions
	var asJSON bool
	fs.StringVar(&o.Directory, "directory", "", "dedicated managed installation root")
	fs.StringVar(&o.Bundle, "bundle", "", "local signed release bundle")
	fs.StringVar(&o.Version, "version", "", "exact public release version")
	fs.StringVar(&o.Trust, "trust", "", "preprovisioned trust; required on first install")
	fs.BoolVar(&o.Preview, "preview", false, "explicitly select a prerelease")
	fs.BoolVar(&asJSON, "json", false, "omit download progress")
	if err := fs.Parse(args); errors.Is(err, flag.ErrHelp) {
		_, err = fmt.Fprintln(out, installUsage)
		return err
	} else if err != nil || fs.NArg() != 0 || (o.Directory == "" && runtime.GOOS != "windows") || (o.Bundle == "") == (o.Version == "") {
		return errors.New(installUsage)
	}
	if !asJSON {
		o.Progress = progress
	}
	ctx, cancel := context.WithTimeout(ctx, time.Hour)
	defer cancel()
	result, err := release.InstallCLI(ctx, o)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}
func installationStatus(args []string, out io.Writer) error {
	const usage = "usage: vaultix update status [--directory DIR] [--json] (directory is required on Linux; Windows uses its per-user application directory)"
	fs := flag.NewFlagSet("update status", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var directory string
	var jsonFlag bool
	fs.StringVar(&directory, "directory", "", "managed installation root")
	fs.BoolVar(&jsonFlag, "json", false, "structured output")
	if err := fs.Parse(args); errors.Is(err, flag.ErrHelp) {
		_, err = fmt.Fprintln(out, usage)
		return err
	} else if err != nil || fs.NArg() != 0 || (directory == "" && runtime.GOOS != "windows") {
		return errors.New(usage)
	}
	result, err := release.CLIInstallation(directory)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}
