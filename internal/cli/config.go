// Package cli implements the vaultix commands.
package cli

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Config is the non-secret settings file (~/.config/vaultix/config.json).
type Config struct {
	API     string `json:"api"`
	Project string `json:"project"` // slug
	Env     string `json:"env"`
	Path    string `json:"path"`
	KeyFile string `json:"key_file,omitempty"` // headless data-key file instead of the OS keyring
}

// Dir is the vaultix config directory (VAULTIX_HOME overrides).
func Dir() string {
	if d := os.Getenv("VAULTIX_HOME"); d != "" {
		return d
	}
	d, err := os.UserConfigDir()
	if err != nil {
		d = "."
	}
	return filepath.Join(d, "vaultix")
}

// LoadConfig reads the config, with defaults for a fresh install.
func LoadConfig() (*Config, error) {
	c := &Config{API: "https://secrets.shippin.cloud", Env: "dev", Path: "/"}
	b, err := os.ReadFile(filepath.Join(Dir(), "config.json"))
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return nil, err
	}
	return c, json.Unmarshal(b, c)
}

// Save writes the config (0600; it holds no secrets but names projects).
func (c *Config) Save() error {
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(filepath.Join(Dir(), "config.json"), append(b, '\n'), 0o600)
}

// scopeName names the local store file for the configured scope.
func (c *Config) scopeName() string {
	h := c.Project + "." + c.Env + c.Path
	out := make([]rune, 0, len(h))
	for _, r := range h {
		if r == '/' {
			r = '_'
		}
		out = append(out, r)
	}
	return string(out)
}
