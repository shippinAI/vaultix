package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"shippin.cloud/vaultix/internal/release"
)

var requiredStages = []string{"source-inventory", "migration-map", "login-failure-policy", "owned-source", "source-archive", "extract-source", "canonical-image", "image-identity", "identity-lifetime", "dragonfly-application", "redis-application", "encrypted-recovery", "tenant-isolation", "proxy-boundary", "admission-dragonfly", "admission-redis"}

func candidate(ctx context.Context, d *Docker, o Options, previous *release.ReleaseCheckpoint) (Candidate, error) {
	var c Candidate
	if (o.BuildReceipt == "") == (o.Bundle == "") {
		return c, errors.New("select exactly one --from-build receipt or --bundle with --trust")
	}
	if o.BuildReceipt != "" {
		if o.Trust != "" {
			return c, errors.New("--trust belongs to signed bundles")
		}
		raw, err := release.ReadReleaseMetadata(o.BuildReceipt, 1024*1024)
		if err != nil {
			return c, err
		}
		var r struct {
			Passed                   bool
			Fixtures                 bool
			Revision, Image, ImageID string
			Steps                    []struct {
				Name     string
				Passed   bool
				ExitCode *int
			}
		}
		if json.Unmarshal(raw, &r) != nil || !r.Passed || r.Fixtures || !revisionPattern.MatchString(r.Revision) || !imagePattern.MatchString(r.ImageID) || r.Image != "vaultix:"+r.Revision {
			return c, errors.New("not a successful committed canonical build receipt")
		}
		seen := map[string]bool{}
		for _, s := range r.Steps {
			if seen[s.Name] || !s.Passed || s.ExitCode == nil || *s.ExitCode != 0 {
				return c, errors.New("invalid or incomplete canonical stage")
			}
			seen[s.Name] = true
		}
		for _, name := range requiredStages {
			if !seen[name] {
				return c, errors.New("required canonical stage is missing")
			}
		}
		c = Candidate{Image: r.ImageID, Revision: r.Revision, Evidence: digest(raw), Trust: "local-build"}
	} else {
		if o.Trust == "" {
			return c, errors.New("signed bundles require preprovisioned --trust")
		}
		raw, err := release.ReadReleaseMetadata(filepath.Join(o.Bundle, "release-manifest.json"), 65536)
		if err != nil {
			return c, err
		}
		sig, err := release.ReadReleaseMetadata(filepath.Join(o.Bundle, "release-signature.json"), 4096)
		if err != nil {
			return c, err
		}
		trust, err := release.ReadReleaseMetadata(o.Trust, 16384)
		if err != nil {
			return c, err
		}
		m, cp, err := release.VerifyRelease(raw, sig, trust, time.Now(), previous)
		if err != nil {
			return c, err
		}
		if err = release.VerifyReleaseArtifacts(m, o.Bundle); err != nil {
			return c, err
		}
		for _, a := range m.Artifacts {
			if a.Kind != "engine" {
				continue
			}
			c = Candidate{Image: *a.ImageID, Revision: m.Revision, Evidence: digest(raw), Trust: "signed-bundle", Checkpoint: &cp, ExpiresAt: m.ExpiresAt}
			if err = d.image(ctx, c.Image, c.Revision); err != nil {
				f, err := os.Open(filepath.Join(o.Bundle, a.Name))
				if err != nil {
					return c, err
				}
				h := sha256.New()
				err = d.stream(ctx, io.TeeReader(io.LimitReader(f, a.Bytes+1), h), io.Discard, "image", "load", "--quiet")
				f.Close()
				if err != nil {
					return c, err
				}
				if hex.EncodeToString(h.Sum(nil)) != a.SHA256 {
					return c, errors.New("image archive changed while loading")
				}
			}
		}
	}
	if err := d.image(ctx, c.Image, c.Revision); err != nil {
		return c, err
	}
	var err error
	c.Migrations, err = d.migrations(ctx, c.Image)
	return c, err
}
