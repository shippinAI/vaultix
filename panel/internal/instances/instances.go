// Package instances serves the overview list: every deployed Vaultix this
// panel knows about, metadata only. Registry is a JSON file the operator
// edits; health is probed live against each instance's /api/v1/vaultix/health.
package instances

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const HealthPath = "/api/v1/vaultix/health"

type Instance struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Host string `json:"host"`
	URL  string `json:"url"`
	// LastBackup is operator-maintained until the backup job reports in.
	LastBackup string `json:"lastBackup,omitempty"`
}

// View is what the panel renders. No secret names, no secret values.
type View struct {
	Instance
	Health string `json:"health"` // ok | unreachable
}

type Registry struct {
	mu    sync.RWMutex
	items []Instance
	probe *http.Client
}

func self() []Instance {
	return []Instance{{ID: "vaultix", Name: "Vaultix", Host: "127.0.0.1", URL: "self"}}
}

func Load(path string) (*Registry, error) {
	probe := &http.Client{Timeout: 3 * time.Second}
	if path == "" {
		return &Registry{items: self(), probe: probe}, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return &Registry{items: self(), probe: probe}, nil
	}
	if err != nil {
		return nil, err
	}
	var items []Instance
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		items = self()
	}
	return &Registry{items: items, probe: probe}, nil
}

func (r *Registry) Get(id string) (Instance, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, it := range r.items {
		if it.ID == id {
			return it, true
		}
	}
	return Instance{}, false
}

// Primary is the first registry entry — the instance link/import target.
func (r *Registry) Primary() (Instance, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.items) == 0 {
		return Instance{}, false
	}
	return r.items[0], true
}

// List probes all instances concurrently and returns views.
func (r *Registry) List(ctx context.Context) []View {
	r.mu.RLock()
	items := make([]Instance, len(r.items))
	copy(items, r.items)
	r.mu.RUnlock()

	views := make([]View, len(items))
	var wg sync.WaitGroup
	for i, it := range items {
		wg.Add(1)
		go func(i int, it Instance) {
			defer wg.Done()
			views[i] = View{Instance: it, Health: r.health(ctx, it.URL)}
		}(i, it)
	}
	wg.Wait()
	return views
}

func (r *Registry) health(ctx context.Context, base string) string {
	if base == "" || base == "self" {
		return "ok"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+HealthPath, nil)
	if err != nil {
		return "unreachable"
	}
	resp, err := r.probe.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return "ok"
	}
	return "unreachable"
}
