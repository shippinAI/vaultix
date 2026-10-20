package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"

	"shippin.cloud/vaultix/internal/api"
	"shippin.cloud/vaultix/internal/store"
)

// Login reads credentials from stdin (never argv): a token line, or with --universal two lines
// (client id, client secret). It verifies them against the API, then stores them in the keyring.
func Login(ctx context.Context, args []string, stdin io.Reader, out io.Writer) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	apiURL := fs.String("api", "", "Vaultix API base URL")
	universal := fs.Bool("universal", false, "machine identity: client id and secret on stdin")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	if *apiURL != "" {
		cfg.API = *apiURL
	}
	sc := bufio.NewScanner(stdin)
	line := func() string { sc.Scan(); return strings.TrimSpace(sc.Text()) }
	c := cred{Type: "token"}
	if *universal {
		c = cred{Type: "universal", ClientID: line(), ClientSecret: line()}
		if c.ClientID == "" || c.ClientSecret == "" {
			return errors.New("login --universal: client id and secret expected on stdin")
		}
		if _, _, err := api.UniversalLogin(ctx, cfg.API, c.ClientID, c.ClientSecret); err != nil {
			return err
		}
	} else {
		if c.Token = line(); c.Token == "" {
			return errors.New("login: token expected on stdin (browser device flow is planned, see README)")
		}
		if err := api.New(cfg.API, c.Token).Status(ctx); err != nil {
			return err
		}
	}
	b, _ := json.Marshal(c)
	if _, err := store.Credential(string(b)); err != nil {
		return fmt.Errorf("keyring: %w (headless: use VAULTIX_TOKEN_FILE)", err)
	}
	if err := cfg.Save(); err != nil {
		return err
	}
	fmt.Fprintf(out, "logged in to %s (%s)\n", cfg.API, c.Type)
	return nil
}

// Logout forgets the stored credential.
func Logout() error { return store.Forget() }

// Init sets the project, environment and folder this directory's user syncs.
func Init(args []string, out io.Writer) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	fs.StringVar(&cfg.API, "api", cfg.API, "API base URL")
	fs.StringVar(&cfg.Project, "project", cfg.Project, "project slug")
	fs.StringVar(&cfg.Env, "env", cfg.Env, "environment slug")
	fs.StringVar(&cfg.Path, "path", cfg.Path, "folder path")
	fs.StringVar(&cfg.KeyFile, "key-file", cfg.KeyFile, "data-key file for headless hosts (0600)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := cfg.Save(); err != nil {
		return err
	}
	fmt.Fprintf(out, "vaultix: %s %s %s\n", cfg.Project, cfg.Env, cfg.Path)
	return nil
}
