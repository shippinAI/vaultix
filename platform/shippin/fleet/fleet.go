// Package fleet is the hosted service's record of customer instances (docs/0125). Each customer
// has their own instance, installed and upgraded by internal/platform exactly as `vaultix server`
// does. The fleet records which instance directory belongs to which customer label and reads each
// instance's state through that same code. It holds no secret values and no customer data.
package fleet

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"

	"shippin.cloud/vaultix/internal/platform"
)

const Schema = "vaultix.fleet.v1"

// Same shape as a hosted label in docs/0014: it becomes {label}.vaultix.cloud.
var labelPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,30}[a-z0-9]$`)

// Profiles are the hosting sizes on offer. They size operated resources; every Vaultix
// feature is included in every profile (docs/0054, Scale and reliability requirements).
var Profiles = []string{"starter", "team", "dedicated"}

type Instance struct {
	Label     string    `json:"label"`
	Customer  string    `json:"customer"`
	Profile   string    `json:"profile"`
	Directory string    `json:"directory"`
	Enrolled  time.Time `json:"enrolled"`
}

type record struct {
	SchemaVersion string     `json:"schemaVersion"`
	Instances     []Instance `json:"instances"`
}

// Executor is the lifecycle entry point; production uses platform.Execute.
type Executor func(ctx context.Context, action string, o platform.Options, progress io.Writer) (platform.Result, error)

type Fleet struct {
	mu      sync.Mutex
	path    string
	execute Executor
}

func Open(controlDirectory string, execute Executor) (*Fleet, error) {
	if execute == nil {
		execute = platform.Execute
	}
	info, err := os.Stat(controlDirectory)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("control directory %q does not exist", controlDirectory)
	}
	return &Fleet{path: filepath.Join(controlDirectory, "fleet.json"), execute: execute}, nil
}

func (f *Fleet) load() (record, error) {
	r := record{SchemaVersion: Schema}
	raw, err := os.ReadFile(f.path)
	if errors.Is(err, os.ErrNotExist) {
		return r, nil
	}
	if err != nil {
		return r, err
	}
	if err = json.Unmarshal(raw, &r); err != nil || r.SchemaVersion != Schema {
		return r, errors.New("the fleet record is unreadable or from another version")
	}
	return r, nil
}

func (f *Fleet) save(r record) error {
	raw, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	temporary := f.path + ".tmp"
	if err = os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, f.path)
}

func (f *Fleet) List() ([]Instance, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, err := f.load()
	sort.Slice(r.Instances, func(a, b int) bool { return r.Instances[a].Label < r.Instances[b].Label })
	return r.Instances, err
}

// Enroll records an instance that `vaultix server install` or `adopt` already manages. It does
// not install anything: the instance directory must exist and be enrolled with the lifecycle.
func (f *Fleet) Enroll(ctx context.Context, in Instance) (Instance, error) {
	if !labelPattern.MatchString(in.Label) {
		return in, fmt.Errorf("label %q must be 2 to 32 lowercase letters, digits or dashes, starting with a letter", in.Label)
	}
	if in.Customer == "" || len(in.Customer) > 200 {
		return in, errors.New("customer name is required and at most 200 characters")
	}
	if !validProfile(in.Profile) {
		return in, fmt.Errorf("profile %q is not one of %v", in.Profile, Profiles)
	}
	directory, err := filepath.Abs(in.Directory)
	if err != nil || in.Directory == "" {
		return in, errors.New("instance directory is required")
	}
	in.Directory = directory
	if _, err = f.execute(ctx, "status", platform.Options{Directory: directory}, io.Discard); err != nil {
		return in, fmt.Errorf("%q is not a managed instance directory: %w", directory, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	r, err := f.load()
	if err != nil {
		return in, err
	}
	for _, existing := range r.Instances {
		if existing.Label == in.Label {
			return in, fmt.Errorf("label %q is already enrolled", in.Label)
		}
		if existing.Directory == directory {
			return in, fmt.Errorf("that directory is already enrolled as %q", existing.Label)
		}
	}
	in.Enrolled = time.Now().UTC().Truncate(time.Second)
	r.Instances = append(r.Instances, in)
	return in, f.save(r)
}

func validProfile(p string) bool {
	for _, known := range Profiles {
		if p == known {
			return true
		}
	}
	return false
}

// Health is what the operator sees for one instance: never keys, setup codes or links.
type Health struct {
	Instance
	SiteURL          string `json:"siteUrl,omitempty"`
	Image            string `json:"image,omitempty"`
	Phase            string `json:"phase,omitempty"`
	Ready            bool   `json:"ready"`
	RecoveryRequired bool   `json:"recoveryRequired"`
	Error            string `json:"error,omitempty"`
}

func (f *Fleet) Health(ctx context.Context) ([]Health, error) {
	instances, err := f.List()
	if err != nil {
		return nil, err
	}
	out := make([]Health, len(instances))
	var wg sync.WaitGroup
	for i, in := range instances {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h := Health{Instance: in}
			checkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			result, err := f.execute(checkCtx, "status", platform.Options{Directory: in.Directory}, io.Discard)
			if err != nil {
				h.Error = err.Error()
			} else {
				h.SiteURL, h.Ready, h.RecoveryRequired = result.Instance.SiteURL, result.Ready, result.RecoveryRequired
				if result.Operation != nil {
					h.Phase, h.Image = result.Operation.Phase, result.Operation.Candidate.Image
				}
			}
			out[i] = h
		}()
	}
	wg.Wait()
	return out, nil
}
