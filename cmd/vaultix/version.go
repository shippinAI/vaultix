package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"runtime/debug"

	"shippin.cloud/vaultix/internal/release"
)

var version = "dev"
var revision = "unknown"

func buildRevision() string {
	if revision != "unknown" {
		return revision
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			if setting.Key == "vcs.revision" {
				return setting.Value
			}
		}
	}
	return revision
}

func printVersion(args []string, out io.Writer) error {
	asJSON := len(args) == 1 && args[0] == "--json"
	if len(args) > 0 && !asJSON {
		return errors.New("usage: vaultix version [--json]")
	}
	if asJSON {
		return json.NewEncoder(out).Encode(struct {
			Product  string `json:"product"`
			Version  string `json:"version"`
			Revision string `json:"revision"`
			OS       string `json:"os"`
			Arch     string `json:"arch"`
		}{"Vaultix CLI", version, buildRevision(), runtime.GOOS, runtime.GOARCH})
	}
	_, err := fmt.Fprintf(out, "Vaultix CLI %s (%s; %s/%s)\n", version, buildRevision(), runtime.GOOS, runtime.GOARCH)
	return err
}

func checkUpdate(ctx context.Context, args []string, out io.Writer) error {
	if len(args) > 0 && args[0] == "download" {
		return downloadRelease(ctx, args[1:], out, os.Stderr)
	}
	if len(args) > 0 && args[0] == "verify" {
		return verifyReleaseBundle(args[1:], out)
	}
	if len(args) < 1 || args[0] != "check" || len(args) > 2 || (len(args) == 2 && args[1] != "--json") {
		return errors.New("usage: vaultix update check [--json]")
	}
	status := release.Status{SchemaVersion: "vaultix.updates.v1", State: "disabled", CurrentVersion: version, ReleaseURL: release.ReleasesURL, Channel: "stable"}
	var err error
	if !release.Disabled() {
		status, err = release.NewClient().Check(ctx, version)
	}
	if len(args) == 2 {
		if writeErr := json.NewEncoder(out).Encode(status); writeErr != nil {
			return writeErr
		}
		return err
	}
	messages := map[string]string{
		"disabled":    "External update checks are disabled by VAULTIX_DISABLE_UPDATE_CHECK.",
		"development": "This is a development build; it cannot be compared with published releases.",
		"unpublished": "No public stable Vaultix release was found.",
		"available":   "A newer Vaultix release is available.",
		"current":     "This version is at or ahead of the latest stable release.",
		"unavailable": "Update status is unavailable.",
	}
	if _, writeErr := fmt.Fprintf(out, "%s\nInstalled: %s\n", messages[status.State], version); writeErr != nil {
		return writeErr
	}
	if status.LatestVersion != "" {
		if _, writeErr := fmt.Fprintf(out, "Latest stable: %s\n", status.LatestVersion); writeErr != nil {
			return writeErr
		}
	}
	if _, writeErr := fmt.Fprintf(out, "Release notes and installation: %s\nNo software was installed.\n", status.ReleaseURL); writeErr != nil {
		return writeErr
	}
	return err
}
