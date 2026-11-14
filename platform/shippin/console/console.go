// Package console is the private operator console for the hosted service (docs/0125). It is not
// part of the Vaultix image and is never reachable from the internet: it listens on loopback only
// and every request needs the operator key kept in the control directory. It shows and changes the
// fleet record; it never shows keys, setup codes, reset links or secret values.
package console

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"shippin.cloud/vaultix/platform/shippin/fleet"
)

const cookieName = "vaultix_control"

//go:embed page.html
var pageSource string

var page = template.Must(template.New("page").Parse(pageSource))

type Console struct {
	fleet *fleet.Fleet
	key   [32]byte
}

// OperatorKey reads the operator key, creating it on first use. Only its file path is ever shown.
func OperatorKey(controlDirectory string) (string, string, error) {
	path := filepath.Join(controlDirectory, "operator.key")
	if raw, err := os.ReadFile(path); err == nil {
		key := strings.TrimSpace(string(raw))
		if len(key) < 32 {
			return "", path, errors.New("operator.key is too short; delete it to generate a new one")
		}
		return key, path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", path, err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", path, err
	}
	key := "vxc-" + hex.EncodeToString(b)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", path, err
	}
	defer file.Close()
	_, err = file.WriteString(key + "\n")
	return key, path, err
}

func New(f *fleet.Fleet, operatorKey string) *Console {
	return &Console{fleet: f, key: sha256.Sum256([]byte(operatorKey))}
}

// RequireLoopback refuses any listen address that is not a loopback interface.
func RequireLoopback(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return errors.New("the control console listens on loopback only; reach it over SSH or a private tunnel")
	}
	return nil
}

func (c *Console) authorized(r *http.Request) bool {
	presented := ""
	if bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		presented = bearer
	} else if cookie, err := r.Cookie(cookieName); err == nil {
		presented = cookie.Value
	}
	digest := sha256.Sum256([]byte(presented))
	return presented != "" && subtle.ConstantTimeCompare(digest[:], c.key[:]) == 1
}

// Browser form posts must come from this console itself.
func sameOrigin(r *http.Request) bool {
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin" || site == "none"
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (c *Console) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", c.home)
	mux.HandleFunc("POST /login", c.login)
	mux.HandleFunc("POST /logout", c.logout)
	mux.HandleFunc("POST /fleet/instances", c.enrollForm)
	mux.HandleFunc("GET /api/fleet", c.apiFleet)
	mux.HandleFunc("POST /api/fleet/instances", c.apiEnroll)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}

type view struct {
	SignedIn bool
	Error    string
	Fleet    []fleet.Health
	Profiles []string
	Checked  string
}

func (c *Console) render(w http.ResponseWriter, r *http.Request, status int, message string) {
	v := view{SignedIn: c.authorized(r), Error: message, Profiles: fleet.Profiles}
	if v.SignedIn {
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		health, err := c.fleet.Health(ctx)
		if err != nil && v.Error == "" {
			v.Error = err.Error()
		}
		v.Fleet, v.Checked = health, time.Now().UTC().Format(time.RFC3339)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_ = page.Execute(w, v)
}

func (c *Console) home(w http.ResponseWriter, r *http.Request) { c.render(w, r, http.StatusOK, "") }

func (c *Console) login(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	key := strings.TrimSpace(r.PostFormValue("key"))
	digest := sha256.Sum256([]byte(key))
	if !sameOrigin(r) || key == "" || subtle.ConstantTimeCompare(digest[:], c.key[:]) != 1 {
		c.render(w, r, http.StatusUnauthorized, "That is not the operator key for this control directory.")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: key, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 8 * 3600})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (c *Console) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (c *Console) enrollForm(w http.ResponseWriter, r *http.Request) {
	if !c.authorized(r) || !sameOrigin(r) {
		c.render(w, r, http.StatusUnauthorized, "Sign in with the operator key first.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	_, err := c.fleet.Enroll(r.Context(), fleet.Instance{
		Label: strings.TrimSpace(r.PostFormValue("label")), Customer: strings.TrimSpace(r.PostFormValue("customer")),
		Profile: r.PostFormValue("profile"), Directory: strings.TrimSpace(r.PostFormValue("directory")),
	})
	if err != nil {
		c.render(w, r, http.StatusBadRequest, err.Error())
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (c *Console) apiFleet(w http.ResponseWriter, r *http.Request) {
	if !c.authorized(r) {
		fail(w, http.StatusUnauthorized, "The operator key is required.")
		return
	}
	health, err := c.fleet.Health(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"instances": health})
}

func (c *Console) apiEnroll(w http.ResponseWriter, r *http.Request) {
	if !c.authorized(r) {
		fail(w, http.StatusUnauthorized, "The operator key is required.")
		return
	}
	var in fleet.Instance
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "The body must be JSON with label, customer, profile and directory.")
		return
	}
	enrolled, err := c.fleet.Enroll(r.Context(), in)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"instance": enrolled})
}
