package vault

import (
	"context"
	"fmt"

	"shippin.cloud/vaultix/panel/internal/core"
)

// Mapping pairs an external source project with a Vaultix box.
type Mapping struct {
	SourceProjectID string
	LocalProjectID  string
}

// Report is what the panel shows after an import. Counts only — names and
// values never appear.
type Report struct {
	Projects []ProjectReport `json:"projects"`
}

type ProjectReport struct {
	SourceProjectID string   `json:"sourceProjectId"`
	LocalProjectID  string   `json:"localProjectId"`
	EnvsImported    []string `json:"envsImported"`
	EnvsFailed      []string `json:"envsFailed"`
	SecretsWritten  int      `json:"secretsWritten"`
	Error           string   `json:"error,omitempty"`
}

// Import is a one-way pull from an external leftover source into this engine.
// It never writes back to the source. Destination is always vaultix_* rows.
func Import(ctx context.Context, source *core.Client, dest Engine, tenant string, mappings []Mapping) (Report, error) {
	if dest == nil {
		return Report{}, ErrNoEngine
	}
	if len(mappings) == 0 {
		return Report{}, fmt.Errorf("vault: no project mappings on the link")
	}
	if tenant == "" {
		tenant = "default"
	}
	var rep Report
	for _, m := range mappings {
		rep.Projects = append(rep.Projects, importProject(ctx, source, dest, tenant, m))
	}
	return rep, nil
}

func importProject(ctx context.Context, source *core.Client, dest Engine, tenant string, m Mapping) ProjectReport {
	pr := ProjectReport{SourceProjectID: m.SourceProjectID, LocalProjectID: m.LocalProjectID}
	srcProj, err := source.GetProject(ctx, m.SourceProjectID)
	if err != nil {
		pr.Error = fmt.Sprintf("read source project: %v", err)
		return pr
	}
	name := srcProj.Name
	if name == "" {
		name = m.LocalProjectID
	}
	box, err := dest.EnsureBox(ctx, m.LocalProjectID, tenant, name)
	if err != nil {
		pr.Error = fmt.Sprintf("ensure box: %v", err)
		return pr
	}
	pr.LocalProjectID = box.ID
	for _, env := range srcProj.Environments {
		n, err := importEnv(ctx, source, dest, m.SourceProjectID, box.ID, env.Slug, tenant)
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

func importEnv(ctx context.Context, source *core.Client, dest Engine, sourceProjectID, boxID, env, actor string) (int, error) {
	srcSecrets, err := source.ListSecrets(ctx, sourceProjectID, env)
	if err != nil {
		return 0, fmt.Errorf("list source: %w", err)
	}
	hidden := 0
	for _, s := range srcSecrets {
		if s.Hidden {
			hidden++
		}
	}
	if hidden > 0 {
		return 0, fmt.Errorf("%w: %d of %d", ErrHiddenSource, hidden, len(srcSecrets))
	}
	written := 0
	for _, s := range srcSecrets {
		if _, err := dest.PutSecret(ctx, boxID, env, s.Key, s.Value, actor); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}
