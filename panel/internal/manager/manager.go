package manager

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"shippin.cloud/vaultix/panel/internal/deploy"
)

var ErrBadLabel = errors.New("manager: label must be a hostname label (workshop, studio)")

// Instance is a named Vaultix box. Naming does not provision a VM.
type Instance struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	SKU        string `json:"sku"`
	PublicHost string `json:"publicHost"`
	Tier       string `json:"tier"`
	Self       bool   `json:"self"`
	CreatedAt  string `json:"createdAt"`
}

type Registry struct {
	mu    sync.Mutex
	path  string
	items []Instance
}

func Open(path string) (*Registry, error) {
	r := &Registry{path: path}
	if path == "" {
		return r, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return r, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &r.items); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Registry) EnsureSelf(info deploy.Info, tier string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := "self"
	if info.Label != "" {
		id = info.Label
	}
	for i, it := range r.items {
		if it.Self {
			r.items[i].SKU = info.SKU
			r.items[i].Label = info.Label
			r.items[i].PublicHost = info.PublicHost
			r.items[i].Tier = tier
			r.items[i].ID = id
			return r.saveLocked()
		}
	}
	r.items = append([]Instance{{
		ID: id, Label: info.Label, SKU: info.SKU,
		PublicHost: info.PublicHost, Tier: tier, Self: true,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}}, r.items...)
	return r.saveLocked()
}

func (r *Registry) List() []Instance {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Instance, len(r.items))
	copy(out, r.items)
	return out
}

func (r *Registry) Register(label, sku, tier string) (Instance, error) {
	if !deploy.ValidLabel(label) {
		return Instance{}, ErrBadLabel
	}
	if sku != deploy.SKUHosted {
		sku = deploy.SKUSelf
	}
	host := label
	if sku == deploy.SKUHosted {
		host = label + "." + deploy.HubHost
	}
	inst := Instance{
		ID: label, Label: label, SKU: sku, PublicHost: host, Tier: tier,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, it := range r.items {
		if it.ID == label {
			return it, nil
		}
	}
	r.items = append(r.items, inst)
	if err := r.saveLocked(); err != nil {
		return Instance{}, err
	}
	return inst, nil
}

func (r *Registry) saveLocked() error {
	if r.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(r.items, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}
