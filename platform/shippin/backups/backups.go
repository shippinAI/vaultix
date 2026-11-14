// Package backups keeps every hosted instance inside its profile's backup promise (docs/0125).
// It decides which instances are due and runs `vaultix server backup` for each through
// internal/platform, one instance at a time so a backup round never competes with itself for the
// host. The backup itself, its encryption and its restore check belong to the lifecycle.
package backups

import (
	"context"
	"io"
	"time"

	"shippin.cloud/vaultix/internal/platform"
	"shippin.cloud/vaultix/platform/shippin/fleet"
)

type Outcome struct {
	Label  string `json:"label"`
	Backup string `json:"backup,omitempty"`
	Error  string `json:"error,omitempty"`
}

// RunDue backs up each enrolled instance whose newest verified backup is older than its profile
// allows, keeping the profile's number of backups. It returns one outcome per instance it tried.
func RunDue(ctx context.Context, f *fleet.Fleet, execute fleet.Executor, now time.Time) ([]Outcome, error) {
	if execute == nil {
		execute = f.Executor()
	}
	instances, err := f.List()
	if err != nil {
		return nil, err
	}
	var outcomes []Outcome
	for _, in := range instances {
		if ctx.Err() != nil {
			break
		}
		_, _, overdue, err := fleet.BackupState(in, now)
		if err == nil && !overdue {
			continue
		}
		outcomes = append(outcomes, backUp(ctx, in, execute))
	}
	return outcomes, nil
}

// Now backs up one instance immediately, whatever its schedule.
func Now(ctx context.Context, f *fleet.Fleet, execute fleet.Executor, label string) (Outcome, bool) {
	if execute == nil {
		execute = f.Executor()
	}
	instances, err := f.List()
	if err != nil {
		return Outcome{Label: label, Error: err.Error()}, false
	}
	for _, in := range instances {
		if in.Label == label {
			return backUp(ctx, in, execute), true
		}
	}
	return Outcome{}, false
}

func backUp(ctx context.Context, in fleet.Instance, execute fleet.Executor) Outcome {
	policy, _ := fleet.PolicyFor(in.Profile)
	runCtx, cancel := context.WithTimeout(ctx, 35*time.Minute)
	defer cancel()
	result, err := execute(runCtx, "backup", platform.Options{Directory: in.Directory, Keep: policy.BackupsKept}, io.Discard)
	if err != nil {
		return Outcome{Label: in.Label, Error: err.Error()}
	}
	if result.Backup == nil {
		return Outcome{Label: in.Label, Error: "the lifecycle reported no backup"}
	}
	return Outcome{Label: in.Label, Backup: result.Backup.Name}
}
