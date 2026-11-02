package main

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"path/filepath"
	"time"

	"shippin.cloud/vaultix/internal/release"
)

func verifyReleaseBundle(args []string, out io.Writer) error {
	flags := flag.NewFlagSet("update verify", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	bundle := flags.String("bundle", "", "release bundle directory")
	trust := flags.String("trust", "", "pre-provisioned release trust file")
	prior := flags.String("checkpoint", "", "previous accepted release checkpoint")
	if flags.Parse(args) != nil || flags.NArg() != 0 || *bundle == "" || *trust == "" {
		return errors.New("usage: vaultix update verify --bundle DIRECTORY --trust FILE [--checkpoint FILE]")
	}
	raw, err := release.ReadReleaseMetadata(filepath.Join(*bundle, "release-manifest.json"), 65536)
	if err != nil {
		return err
	}
	signed, err := release.ReadReleaseMetadata(filepath.Join(*bundle, "release-signature.json"), 4096)
	if err != nil {
		return err
	}
	trusted, err := release.ReadReleaseMetadata(*trust, 16384)
	if err != nil {
		return err
	}
	var previous *release.ReleaseCheckpoint
	if *prior != "" {
		previous, err = release.ReadReleaseCheckpoint(*prior)
		if err != nil {
			return err
		}
	}
	manifest, checkpoint, err := release.VerifyRelease(raw, signed, trusted, time.Now(), previous)
	if err != nil {
		return err
	}
	if err := release.VerifyReleaseArtifacts(manifest, *bundle); err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(struct {
		Verified        bool                      `json:"verified"`
		Version         string                    `json:"version"`
		Revision        string                    `json:"revision"`
		Checkpoint      release.ReleaseCheckpoint `json:"checkpoint"`
		PriorCheckpoint bool                      `json:"priorCheckpointSupplied"`
		Installed       bool                      `json:"installed"`
		Scope           string                    `json:"scope"`
	}{true, manifest.Version, manifest.Revision, checkpoint, previous != nil, false,
		"Artifact verification only; retain the checkpoint. No installation, schema compatibility execution or trust rotation."})
}
