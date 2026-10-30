package cli

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"shippin.cloud/vaultix/internal/api"
	"shippin.cloud/vaultix/internal/oidc"
	"shippin.cloud/vaultix/internal/store"
	"shippin.cloud/vaultix/internal/transport"
)

type loginMode int

const (
	modeToken loginMode = iota
	modeUniversal
	modeSSO
)

// chooseLogin picks how a person or a workload signs in.
// A terminal with no flags uses Nomen. A pipe keeps the token-on-stdin path
// so existing scripts still work. --universal is the machine identity.
func chooseLogin(universal, tokenFlag, ssoFlag, interactive bool) (loginMode, error) {
	n := 0
	if universal {
		n++
	}
	if tokenFlag {
		n++
	}
	if ssoFlag {
		n++
	}
	if n > 1 {
		return 0, errors.New("login: choose one of --universal, --token, or --sso")
	}
	switch {
	case universal:
		return modeUniversal, nil
	case tokenFlag:
		return modeToken, nil
	case ssoFlag || interactive:
		return modeSSO, nil
	default:
		return modeToken, nil
	}
}

func isTerminal(r io.Reader) bool {
	f, ok := r.(*os.File)
	if !ok {
		return false
	}
	st, err := f.Stat()
	if err != nil {
		return false
	}
	return st.Mode()&os.ModeCharDevice != 0
}

// CommandName is vaultix, or infisical when this binary is installed under that name.
func CommandName(argv0 string) string {
	base := strings.TrimSuffix(filepath.Base(argv0), ".exe")
	if base == "infisical" {
		return "infisical"
	}
	return "vaultix"
}

// Login signs in. With no flags on a terminal it uses the Nomen device-code
// flow. --universal reads a machine identity on stdin. --token reads an access
// token on stdin. The token is stored in the keyring and is not printed.
func Login(ctx context.Context, args []string, stdin io.Reader, out io.Writer) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	apiURL := fs.String("api", "", "Vaultix API base URL")
	universal := fs.Bool("universal", false, "machine identity: client id and secret on stdin")
	tokenFlag := fs.Bool("token", false, "read an access token from stdin")
	ssoFlag := fs.Bool("sso", false, "Nomen device-code login (the default on a terminal)")
	issuer := fs.String("issuer", os.Getenv("NOMEN_OIDC_ISSUER"), "Nomen issuer (default https://auth.shippin.ai)")
	clientID := fs.String("client-id", os.Getenv("NOMEN_OIDC_CLIENT_ID"), "Nomen public client id")
	scope := fs.String("scope", "openid profile email offline_access", "space-separated Nomen scopes approved for this public client")
	credentialFile := fs.String("credential-file", "", "private credential file on POSIX headless hosts (instead of keyring)")
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
	base, err := transport.URL(cfg.API)
	if err != nil || base.RawQuery != "" {
		return errors.New("login: use an HTTPS API URL or literal loopback HTTP without a query")
	}
	if *credentialFile != "" {
		cfg.CredentialFile, err = filepath.Abs(*credentialFile)
		if err != nil {
			return err
		}
	}
	if os.Getenv("VAULTIX_TOKEN") != "" || os.Getenv("VAULTIX_TOKEN_FILE") != "" {
		return errors.New("login: unset VAULTIX_TOKEN and VAULTIX_TOKEN_FILE first; they override saved sign-in")
	}
	mode, err := chooseLogin(*universal, *tokenFlag, *ssoFlag, isTerminal(stdin))
	if err != nil {
		return err
	}
	sc := bufio.NewScanner(stdin)
	line := func() string { sc.Scan(); return strings.TrimSpace(sc.Text()) }
	c := cred{Type: "token"}
	switch mode {
	case modeUniversal:
		c = cred{Type: "universal", ClientID: line(), ClientSecret: line()}
		if c.ClientID == "" || c.ClientSecret == "" {
			return errors.New("login --universal: client id and secret expected on stdin")
		}
		tok, _, err := api.UniversalLogin(ctx, cfg.API, c.ClientID, c.ClientSecret)
		if err != nil {
			return err
		}
		if err := api.New(cfg.API, tok).VerifyAccess(ctx); err != nil {
			return err
		}
	case modeSSO:
		session, err := (&oidc.Flow{Issuer: *issuer, ClientID: *clientID, Scope: *scope}).RunSession(ctx, out)
		if err != nil {
			return err
		}
		c = cred{Type: "nomen", Token: session.AccessToken, ExpiresAt: session.ExpiresAt, RefreshToken: session.RefreshToken, Issuer: session.Issuer, TokenEndpoint: session.TokenEndpoint, ClientID: *clientID}
		c.RefreshAfter = refreshAfter(session.ExpiresAt)
		if err := api.New(cfg.API, c.Token).VerifyAccess(ctx); err != nil {
			return err
		}
	default:
		if c.Token = line(); c.Token == "" {
			return errors.New("login: token expected on stdin (or run vaultix login on a terminal for Nomen)")
		}
		if err := api.New(cfg.API, c.Token).VerifyAccess(ctx); err != nil {
			return err
		}
	}
	if err := sc.Err(); err != nil {
		return errors.New("login: could not read credential input")
	}
	c.API = strings.TrimRight(cfg.API, "/")
	err = store.WithCredentialLock(ctx, cfg.CredentialFile, func() error { return saveCred(cfg, &c) })
	if err != nil {
		return fmt.Errorf("credential storage: %w (POSIX headless hosts: use --credential-file in a private directory)", err)
	}
	if err := cfg.Save(); err != nil {
		return err
	}
	fmt.Fprintf(out, "logged in to %s (%s)\n", cfg.API, c.Type)
	return nil
}

// Logout forgets the stored credential.
func Logout() error {
	if os.Getenv("VAULTIX_TOKEN") != "" || os.Getenv("VAULTIX_TOKEN_FILE") != "" {
		return errors.New("external credential remains active: unset VAULTIX_TOKEN / VAULTIX_TOKEN_FILE; revoke it at its issuer")
	}
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	return store.WithCredentialLock(ctx, cfg.CredentialFile, func() error {
		if cfg.CredentialFile != "" {
			return store.ForgetCredentialFile(cfg.CredentialFile)
		}
		return store.Forget()
	})
}

// AuthStatus confirms protected access without printing account or token data.
func AuthStatus(ctx context.Context, out io.Writer) error {
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	c, err := authenticatedClient(ctx, cfg)
	if err != nil {
		return err
	}
	if err := c.VerifyAccess(ctx); err != nil {
		return err
	}
	_, err = fmt.Fprintln(out, "Vaultix authenticated project access verified. Secret values were not requested.")
	return err
}

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
