package core

import (
	"context"
	"errors"
	"fmt"
	"sort"
)

// Mapping pairs one source workspace with the local project it imports into.
type Mapping struct {
	SourceProjectID string
	LocalProjectID  string
}

// Report is what the panel shows after an import. Counts only — secret
// names and values never appear in it (contract boundary).
type Report struct {
	Projects []ProjectReport `json:"projects"`
}

type ProjectReport struct {
	SourceProjectID string   `json:"sourceProjectId"`
	LocalProjectID  string   `json:"localProjectId"`
	EnvsImported    []string `json:"envsImported"`
	EnvsSkipped     []string `json:"envsSkipped"` // env exists at source, missing locally
	EnvsFailed      []string `json:"envsFailed"`  // env attempted, error below
	SecretsWritten  int      `json:"secretsWritten"`
	Error           string   `json:"error,omitempty"`
}

// Batch chunking: upstream has no zod cap on the secrets array, but the
// Fastify body limit is ~1 MB and the secret routers don't override it
// (doc 0006 §3). Both bounds keep a chunk comfortably inside that.
const (
	chunkMaxItems = 100
	chunkMaxBytes = 512 * 1024
)

// Import is the one-way pull from doc 0004 §3: read from the linked source,
// write into the local Vaultix instance. Re-runnable: existing secrets are
// updated, new ones created, via the core's batch endpoints (one call per
// chunk instead of one per secret). It never writes back to the source.
func Import(ctx context.Context, source, local *Client, mappings []Mapping) (Report, error) {
	if len(mappings) == 0 {
		return Report{}, fmt.Errorf("import: no project mappings on the link")
	}
	var rep Report
	for _, m := range mappings {
		rep.Projects = append(rep.Projects, importProject(ctx, source, local, m))
	}
	return rep, nil
}

func importProject(ctx context.Context, source, local *Client, m Mapping) ProjectReport {
	pr := ProjectReport{SourceProjectID: m.SourceProjectID, LocalProjectID: m.LocalProjectID}
	srcProj, err := source.GetProject(ctx, m.SourceProjectID)
	if err != nil {
		pr.Error = fmt.Sprintf("read source project: %v", err)
		return pr
	}
	localProj, err := local.GetProject(ctx, m.LocalProjectID)
	if err != nil {
		pr.Error = fmt.Sprintf("read local project: %v", err)
		return pr
	}
	localEnvs := map[string]bool{}
	for _, e := range localProj.Environments {
		localEnvs[e.Slug] = true
	}
	for _, env := range srcProj.Environments {
		if !localEnvs[env.Slug] {
			pr.EnvsSkipped = append(pr.EnvsSkipped, env.Slug)
			continue
		}
		n, err := importEnv(ctx, source, local, m, env.Slug)
		pr.SecretsWritten += n
		if err != nil {
			pr.EnvsFailed = append(pr.EnvsFailed, env.Slug)
			if pr.Error == "" {
				pr.Error = fmt.Sprintf("%s: %v", env.Slug, err)
			}
			continue
		}
		pr.EnvsImported = append(pr.EnvsImported, env.Slug)
	}
	return pr
}

func importEnv(ctx context.Context, source, local *Client, m Mapping, env string) (int, error) {
	srcSecrets, err := source.ListSecrets(ctx, m.SourceProjectID, env)
	if err != nil {
		return 0, fmt.Errorf("list source: %w", err)
	}
	// A hidden value is a placeholder the link identity may not read.
	// Importing it would silently corrupt the target — refuse the env.
	hidden := 0
	for _, s := range srcSecrets {
		if s.Hidden {
			hidden++
		}
	}
	if hidden > 0 {
		return 0, fmt.Errorf("%d of %d secret values hidden from the link identity (needs value-read permission); refusing partial import", hidden, len(srcSecrets))
	}
	existing, err := local.ListSecrets(ctx, m.LocalProjectID, env)
	if err != nil {
		return 0, fmt.Errorf("list local: %w", err)
	}
	// Keys are visible even when local values are hidden; that is all the
	// create/update split needs.
	have := map[string]bool{}
	for _, s := range existing {
		have[keyAt(s)] = true
	}

	creates, updates := map[string][]Secret{}, map[string][]Secret{}
	for _, s := range srcSecrets {
		p := s.Path
		if p == "" {
			p = "/"
		}
		if have[keyAt(s)] {
			updates[p] = append(updates[p], s)
		} else {
			creates[p] = append(creates[p], s)
		}
	}

	written := 0
	for _, group := range []struct {
		byPath map[string][]Secret
		send   func(ctx context.Context, projectID, env, path string, batch []Secret) error
	}{
		{creates, local.BatchCreate},
		{updates, local.BatchUpdate},
	} {
		for _, path := range sortedKeys(group.byPath) {
			for _, chunk := range chunks(group.byPath[path]) {
				if err := group.send(ctx, m.LocalProjectID, env, path, chunk); err != nil {
					if errors.Is(err, ErrApprovalRequired) {
						return written, fmt.Errorf("path %s: target has an approval policy; import writes are held, not applied", path)
					}
					return written, fmt.Errorf("path %s: %w", path, err)
				}
				written += len(chunk)
			}
		}
	}
	return written, nil
}

func keyAt(s Secret) string {
	p := s.Path
	if p == "" {
		p = "/"
	}
	return p + "\x00" + s.Key
}

func sortedKeys(m map[string][]Secret) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func chunks(items []Secret) [][]Secret {
	var out [][]Secret
	var cur []Secret
	size := 0
	for _, s := range items {
		n := len(s.Key) + len(s.Value) + 64
		if len(cur) > 0 && (len(cur) >= chunkMaxItems || size+n > chunkMaxBytes) {
			out = append(out, cur)
			cur, size = nil, 0
		}
		cur = append(cur, s)
		size += n
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}
