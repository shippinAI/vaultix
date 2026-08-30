// Package httpapi implements shippin.vaultix.panel.v1. Boundary rules from
// the contract: metadata-only responses, secret values never on GET, no
// upstream chrome embedded, link credentials never returned.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"shippin.cloud/vaultix/panel/internal/audit"
	"shippin.cloud/vaultix/panel/internal/core"
	"shippin.cloud/vaultix/panel/internal/deploy"
	"shippin.cloud/vaultix/panel/internal/instances"
	"shippin.cloud/vaultix/panel/internal/license"
	"shippin.cloud/vaultix/panel/internal/manager"
	"shippin.cloud/vaultix/panel/internal/nomen"
	"shippin.cloud/vaultix/panel/internal/pinauth"
	"shippin.cloud/vaultix/panel/internal/store"
	"shippin.cloud/vaultix/panel/internal/usage"
	"shippin.cloud/vaultix/panel/internal/valves"
	"shippin.cloud/vaultix/panel/internal/vault"
)

// Lesson ids from docs/0002 — the panel plays these on the guided path.
var lessons = []string{
	"vaultix.lesson.keys-are-not-chat",
	"vaultix.lesson.one-project",
	"vaultix.lesson.inject-not-paste",
	"vaultix.lesson.rotate",
}

const injectTTL = 90 * time.Second

type Server struct {
	Store          *store.Store
	Pins           *pinauth.Authenticator
	Registry       *instances.Registry
	Audit          *audit.Log
	Vault          vault.Engine
	Nomen          *nomen.Verifier
	License        license.Grant
	Deploy         deploy.Info
	Manager        *manager.Registry
	IdentityHeader string
	SourceURL      string
	// Local is the owned engine in core/ this panel fronts. When set,
	// secrets live there — not in the overlay store.
	Local struct {
		URL, ClientID, ClientSecret string
	}

	// Metering (doc 0010): OPTIONAL. Meter.Enforce defaults false, so metering
	// is observational only unless an operator opts in. The capability exists
	// so turning it on later is a flag, not a retrofit.
	Meter usage.Meter

	// Dormant capability valves (doc 0003 gap ledger). Zero value = all
	// closed. Rate cap is a pointer because it holds state.
	Valves  valves.Set
	RateCap *valves.RateCap
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/vaultix/health", s.health)
	mux.HandleFunc("GET /api/v1/vaultix/trust", s.trust)
	mux.HandleFunc("GET /api/v1/vaultix/license", s.getLicense)
	mux.HandleFunc("GET /api/v1/vaultix/instance", s.getInstance)
	mux.HandleFunc("GET /api/v1/vaultix/manager/instances", s.withUser(s.listManaged))
	mux.HandleFunc("POST /api/v1/vaultix/manager/instances", s.elevated(s.registerManaged))
	mux.HandleFunc("GET /api/v1/vaultix/lessons", s.withUser(s.getLessons))
	mux.HandleFunc("GET /api/v1/vaultix/instances", s.withUser(s.listInstances))
	mux.HandleFunc("POST /api/v1/vaultix/session/pin", s.withUser(s.setPin))
	mux.HandleFunc("POST /api/v1/vaultix/session/stepup", s.withUser(s.stepUp))
	mux.HandleFunc("POST /api/v1/vaultix/projects", s.elevated(s.createProject))
	mux.HandleFunc("GET /api/v1/vaultix/projects/{projectId}/secrets", s.withUser(s.listSecrets))
	mux.HandleFunc("PUT /api/v1/vaultix/projects/{projectId}/secrets/{name}", s.elevated(s.putSecret))
	mux.HandleFunc("POST /api/v1/vaultix/inject", s.elevated(s.inject))
	mux.HandleFunc("POST /api/v1/vaultix/inject/{handle}/redeem", s.redeemInject)
	mux.HandleFunc("POST /api/v1/vaultix/link", s.elevated(s.putLink))
	mux.HandleFunc("GET /api/v1/vaultix/link", s.withUser(s.getLink))
	mux.HandleFunc("DELETE /api/v1/vaultix/link", s.elevated(s.deleteLink))
	mux.HandleFunc("POST /api/v1/vaultix/import", s.elevated(s.runImport))
	// Source API (doc 0009): the operable, observable action surface —
	// same for a human and a Vaultix specialist Clyffy.
	mux.HandleFunc("GET /api/v1/vaultix/source/manifest", s.withUser(s.sourceManifest))
	mux.HandleFunc("POST /api/v1/vaultix/source/act", s.elevated(s.sourceAct))
	mux.HandleFunc("GET /api/v1/vaultix/catalog", s.withUser(s.getCatalog))
	mux.HandleFunc("GET /api/v1/vaultix/viewport", s.withUser(s.getViewport))
	mux.HandleFunc("POST /api/v1/vaultix/runtime/answer", s.withUser(s.runtimeAnswer))
	mux.HandleFunc("GET /api/v1/vaultix/configure", s.withUser(s.configureShow))
	mux.HandleFunc("GET /api/v1/vaultix/mcp/manifest", s.withUser(s.mcpManifest))
	mux.HandleFunc("POST /api/v1/vaultix/mcp", s.withUser(s.mcpRPC))
	mux.HandleFunc("GET /viewport/", s.viewportPage)
	mux.HandleFunc("GET /viewport", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/viewport/", http.StatusFound)
	})
	mux.HandleFunc("GET /manager/", s.managerPage)
	mux.HandleFunc("GET /manager", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/manager/", http.StatusFound)
	})
	mux.HandleFunc("GET /favicon.svg", s.brandFile)
	mux.HandleFunc("GET /branding/{name}", s.brandFile)
	// Usage/plan meter (doc 0010) — observational unless enforcement opted in.
	mux.HandleFunc("GET /api/v1/vaultix/usage", s.withUser(s.getUsage))
	// Capabilities manifest (doc 0003 valves) — lists every dormant valve
	// and whether it's open. The option is discoverable even while closed.
	mux.HandleFunc("GET /api/v1/vaultix/capabilities", s.withUser(s.getCapabilities))
	// IP allowlist valve wraps the whole surface (no-op when closed).
	return s.ipGuard(mux)
}

// ipGuard applies the IP-allowlist valve to every request. Closed => no-op.
func (s *Server) ipGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.license().Allows(license.FeatIPAllowlist) && !s.Valves.IPAllowlist.Allowed(r.RemoteAddr) {
			fail(w, http.StatusForbidden, "source network not allowed")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- middleware ---

func (s *Server) user(r *http.Request) string {
	if s.Nomen != nil {
		if tok := bearer(r); tok != "" {
			id, err := s.Nomen.Verify(r.Context(), tok)
			if err == nil && id.Subject != "" {
				return id.Subject
			}
		}
	}
	if s.IdentityHeader != "" {
		if u := strings.TrimSpace(r.Header.Get(s.IdentityHeader)); u != "" {
			return u
		}
	}
	return ""
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func (s *Server) withUser(h func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := s.user(r)
		if u == "" {
			fail(w, http.StatusUnauthorized, "no authenticated identity; present a Nomen bearer token")
			return
		}
		h(w, r, u)
	}
}

// elevated requires a valid step-up session scoped to the primary instance.
// Every elevated op in v1 targets the primary (doc 0004 §2).
func (s *Server) elevated(h func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return s.withUser(func(w http.ResponseWriter, r *http.Request, u string) {
		sess, err := s.Pins.Check(u, r.Header.Get("X-Vaultix-Elevated"))
		if err != nil {
			fail(w, http.StatusForbidden, "step-up required: POST /api/v1/vaultix/session/stepup")
			return
		}
		if primary, ok := s.Registry.Primary(); ok && sess.InstanceID != primary.ID {
			fail(w, http.StatusForbidden, "elevated session is for a different instance")
			return
		}
		// Rate-cap valve (closed => no-op): ceiling sensitive actions per user.
		if s.license().Allows(license.FeatRateCap) && !s.RateCap.Allow(u) {
			s.Audit.Record(u, "ratecap.blocked", r.URL.Path, false, "per-user rate cap")
			fail(w, http.StatusTooManyRequests, "rate cap reached; try again shortly")
			return
		}
		h(w, r, u)
	})
}

// approvalHeld reports whether the approval-gate valve is open. When open,
// sensitive write actions are held for approval instead of applied. Closed
// => false (apply immediately). Callers audit the hold.
func (s *Server) approvalHeld(user, action, target string) bool {
	if !s.license().Allows(license.FeatApproval) || !s.Valves.ApprovalGate.Required() {
		return false
	}
	s.Audit.Record(user, "approval.held", action+" "+target, true, "approval-gate valve open")
	return true
}

// --- handlers ---

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	engine := "overlay"
	if s.Local.URL != "" {
		engine = "core"
		statusURL := strings.TrimRight(s.Local.URL, "/") + "/api/status"
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, statusURL, nil)
		if err != nil {
			fail(w, http.StatusServiceUnavailable, "core status request")
			return
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			fail(w, http.StatusServiceUnavailable, "core not ready")
			return
		}
		defer res.Body.Close()
		if res.StatusCode >= 400 {
			fail(w, http.StatusServiceUnavailable, "core not ready")
			return
		}
	} else if s.Vault == nil {
		fail(w, http.StatusServiceUnavailable, "vault not configured")
		return
	} else if err := s.Vault.Healthy(r.Context()); err != nil {
		fail(w, http.StatusServiceUnavailable, "vault not ready")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "product": "vaultix", "engine": engine,
		"contract": "shippin.vaultix.panel.v1",
		"sku": s.Deploy.SKU, "publicHost": s.Deploy.PublicHost,
	})
}

func (s *Server) trust(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"product": "Vaultix",
		"owner":   license.Owner,
		"host":    license.Host,
		"stamp":   license.Stamp,
		"trusts":     "nomen",
		"engine":     "core",
		"tier":       s.license().Tier,
		"sku":        s.Deploy.SKU,
		"label":      s.Deploy.Label,
		"publicHost": s.Deploy.PublicHost,
		"hub":        s.Deploy.Hub,
	})
}

func (s *Server) getLicense(w http.ResponseWriter, _ *http.Request) {
	g := s.license()
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) localCore(ctx context.Context) (*core.Client, error) {
	if s.Local.URL == "" || s.Local.ClientID == "" {
		return nil, nil
	}
	c := core.New(s.Local.URL)
	if err := c.Login(ctx, s.Local.ClientID, s.Local.ClientSecret); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Server) license() license.Grant {
	if s.License.Product == "" {
		return license.CommunityGrant()
	}
	return s.License
}

func (s *Server) getLessons(w http.ResponseWriter, _ *http.Request, _ string) {
	writeJSON(w, http.StatusOK, map[string]any{"lessons": lessons})
}

func (s *Server) listInstances(w http.ResponseWriter, r *http.Request, _ string) {
	writeJSON(w, http.StatusOK, map[string]any{"instances": s.Registry.List(r.Context())})
}

func (s *Server) setPin(w http.ResponseWriter, r *http.Request, u string) {
	var in struct {
		InstanceID string `json:"instanceId"`
		CurrentPin string `json:"currentPin"`
		NewPin     string `json:"newPin"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if _, ok := s.Registry.Get(in.InstanceID); !ok {
		fail(w, http.StatusNotFound, "unknown instance")
		return
	}
	err := s.Pins.SetPin(u, in.InstanceID, in.CurrentPin, in.NewPin)
	s.Audit.Record(u, "session.pin.set", in.InstanceID, err == nil, errText(err))
	if err != nil {
		fail(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "pin set"})
}

func (s *Server) stepUp(w http.ResponseWriter, r *http.Request, u string) {
	var in struct {
		InstanceID string `json:"instanceId"`
		Pin        string `json:"pin"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	token, exp, err := s.Pins.StepUp(u, in.InstanceID, in.Pin)
	s.Audit.Record(u, "session.stepup", in.InstanceID, err == nil, errText(err))
	if err != nil {
		fail(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "expiresAt": exp.UTC()})
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request, u string) {
	var in struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Name == "" {
		fail(w, http.StatusBadRequest, "name required")
		return
	}
	// Optional plan meter (doc 0010). Enforce defaults off, so this is a
	// no-op unless an operator opted in — the anti-goal (doc 0003) holds by
	// default, the option exists when wanted.
	if ok, reason := s.Meter.Allow(usage.Projects, s.snapshot(r.Context())[usage.Projects]); !ok {
		s.Audit.Record(u, "project.create.blocked", in.Name, false, reason)
		fail(w, http.StatusPaymentRequired, reason)
		return
	}
	if c, err := s.localCore(r.Context()); err != nil {
		fail(w, http.StatusServiceUnavailable, err.Error())
		return
	} else if c != nil {
		id, err := c.CreateProject(r.Context(), in.Name)
		s.Audit.Record(u, "project.create", in.Name, err == nil, errText(err))
		if err != nil {
			fail(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"projectId": id, "name": in.Name})
		return
	}
	if s.Vault == nil {
		fail(w, http.StatusServiceUnavailable, vault.ErrNoEngine.Error())
		return
	}
	box, err := s.Vault.CreateBox(r.Context(), u, in.Name)
	s.Audit.Record(u, "project.create", in.Name, err == nil, errText(err))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"projectId": box.ID, "name": box.Name, "slug": box.Slug})
}

func (s *Server) putSecret(w http.ResponseWriter, r *http.Request, u string) {
	projectID, name := r.PathValue("projectId"), r.PathValue("name")
	var in struct {
		Environment string `json:"environment"`
		Value       string `json:"value"`
		Path        string `json:"path"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Environment == "" {
		fail(w, http.StatusBadRequest, "environment required")
		return
	}
	// Access-policy valve (closed => allow): deny writes under blocked paths.
	if s.license().Allows(license.FeatAccessPolicy) && !s.Valves.AccessPolicy.Allows(in.Path) {
		s.Audit.Record(u, "secret.put.denied", projectID+"/"+in.Environment+"/"+name, false, "access policy")
		fail(w, http.StatusForbidden, "access policy denies this path")
		return
	}
	// Approval-gate valve (closed => apply now): hold the write for approval.
	if s.approvalHeld(u, "secret.put", projectID+"/"+in.Environment+"/"+name) {
		writeJSON(w, http.StatusAccepted, map[string]any{"held": true, "reason": "approval required before this change applies"})
		return
	}
	if c, err := s.localCore(r.Context()); err != nil {
		fail(w, http.StatusServiceUnavailable, err.Error())
		return
	} else if c != nil {
		err := c.UpsertSecret(r.Context(), projectID, in.Environment, core.Secret{Key: name, Value: in.Value, Path: in.Path})
		s.Audit.Record(u, "secret.put", projectID+"/"+in.Environment+"/"+name, err == nil, errText(err))
		if err != nil {
			fail(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"projectId": projectID, "environment": in.Environment, "name": name,
			"updatedAt": time.Now().UTC(),
		})
		return
	}
	if s.Vault == nil {
		fail(w, http.StatusServiceUnavailable, vault.ErrNoEngine.Error())
		return
	}
	meta, err := s.Vault.PutSecret(r.Context(), projectID, in.Environment, name, in.Value, u)
	s.Audit.Record(u, "secret.put", projectID+"/"+in.Environment+"/"+name, err == nil, errText(err))
	if err != nil {
		if errors.Is(err, vault.ErrNotFound) {
			fail(w, http.StatusNotFound, "box not found")
			return
		}
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"projectId": meta.BoxID, "environment": meta.Env, "name": meta.Name,
		"version": meta.Version, "updatedAt": meta.UpdatedAt.UTC(),
	})
}

func (s *Server) listSecrets(w http.ResponseWriter, r *http.Request, _ string) {
	if s.Vault == nil {
		fail(w, http.StatusServiceUnavailable, vault.ErrNoEngine.Error())
		return
	}
	projectID := r.PathValue("projectId")
	env := r.URL.Query().Get("environment")
	list, err := s.Vault.ListSecretMeta(r.Context(), projectID, env)
	if err != nil {
		if errors.Is(err, vault.ErrNotFound) {
			fail(w, http.StatusNotFound, "box not found")
			return
		}
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if list == nil {
		list = []vault.SecretMeta{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projectId": projectID, "secrets": list})
}

func (s *Server) inject(w http.ResponseWriter, r *http.Request, u string) {
	var in struct {
		ProjectID   string `json:"projectId"`
		Environment string `json:"environment"`
		Name        string `json:"name"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.ProjectID == "" || in.Environment == "" || in.Name == "" {
		fail(w, http.StatusBadRequest, "projectId, environment, and name required")
		return
	}
	if s.Vault == nil {
		fail(w, http.StatusServiceUnavailable, vault.ErrNoEngine.Error())
		return
	}
	handle, exp, err := s.Vault.MintInject(r.Context(), in.ProjectID, in.Environment, in.Name, u, injectTTL)
	s.Audit.Record(u, "secret.inject", in.ProjectID+"/"+in.Environment+"/"+in.Name, err == nil, errText(err))
	if err != nil {
		if errors.Is(err, vault.ErrNotFound) {
			fail(w, http.StatusNotFound, "secret not found")
			return
		}
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"handle": handle, "expiresAt": exp.UTC()})
}

func (s *Server) redeemInject(w http.ResponseWriter, r *http.Request) {
	if s.Vault == nil {
		fail(w, http.StatusServiceUnavailable, vault.ErrNoEngine.Error())
		return
	}
	handle := r.PathValue("handle")
	out, err := s.Vault.ConsumeInject(r.Context(), handle)
	if err != nil {
		code := http.StatusNotFound
		if errors.Is(err, vault.ErrExpired) || errors.Is(err, vault.ErrConsumed) {
			code = http.StatusGone
		}
		s.Audit.Record("", "secret.redeem", handle[:min(8, len(handle))], false, errText(err))
		fail(w, code, err.Error())
		return
	}
	s.Audit.Record("", "secret.redeem", out.BoxID+"/"+out.Env+"/"+out.Name, true, "consumed")
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) putLink(w http.ResponseWriter, r *http.Request, u string) {
	var in struct {
		Source       string `json:"source"`
		BaseURL      string `json:"baseUrl"`
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
		Projects     []struct {
			SourceProjectID string `json:"sourceProjectId"`
			LocalProjectID  string `json:"localProjectId"`
		} `json:"projects"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.ClientID == "" || in.ClientSecret == "" {
		fail(w, http.StatusBadRequest, "clientId and clientSecret required (read-scoped machine identity)")
		return
	}
	source := in.Source
	if source == "" {
		source = "external"
	}
	base := in.BaseURL
	if base == "" {
		base = s.SourceURL
	}
	if base == "" {
		fail(w, http.StatusBadRequest, "baseUrl required")
		return
	}
	// Verify the credential works before storing it.
	probe := core.New(base)
	if err := probe.Login(r.Context(), in.ClientID, in.ClientSecret); err != nil {
		s.Audit.Record(u, "link.create", base, false, "credential check failed")
		fail(w, http.StatusBadGateway, "credential check failed: "+err.Error())
		return
	}
	sealed, err := s.Store.Seal(store.Credential{ClientID: in.ClientID, ClientSecret: in.ClientSecret})
	if err != nil {
		fail(w, http.StatusInternalServerError, "seal failed")
		return
	}
	link := store.LinkRecord{Source: source, BaseURL: base, SealedCredential: sealed, CreatedBy: u, CreatedAt: time.Now().UTC()}
	for _, p := range in.Projects {
		link.Projects = append(link.Projects, store.ProjectMapping{
			SourceProjectID: p.SourceProjectID, LocalProjectID: p.LocalProjectID,
		})
	}
	if err := s.Store.PutLink(link); err != nil {
		fail(w, http.StatusInternalServerError, "store failed")
		return
	}
	s.Audit.Record(u, "link.create", base, true, "")
	writeJSON(w, http.StatusCreated, linkStatus(link))
}

func (s *Server) getLink(w http.ResponseWriter, _ *http.Request, _ string) {
	link, ok := s.Store.GetLink()
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"linked": false})
		return
	}
	writeJSON(w, http.StatusOK, linkStatus(link))
}

func (s *Server) deleteLink(w http.ResponseWriter, _ *http.Request, u string) {
	err := s.Store.DeleteLink()
	if errors.Is(err, store.ErrNotFound) {
		fail(w, http.StatusNotFound, "no link")
		return
	}
	s.Audit.Record(u, "link.delete", "", err == nil, errText(err))
	if err != nil {
		fail(w, http.StatusInternalServerError, "delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"linked": false, "note": "credential deleted; nothing touched on the source side"})
}

func (s *Server) runImport(w http.ResponseWriter, r *http.Request, u string) {
	link, ok := s.Store.GetLink()
	if !ok {
		fail(w, http.StatusConflict, "no source link; POST /api/v1/vaultix/link first")
		return
	}
	cred, err := s.Store.Unseal(link.SealedCredential)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s.Vault == nil {
		fail(w, http.StatusServiceUnavailable, vault.ErrNoEngine.Error())
		return
	}
	source := core.New(link.BaseURL)
	if err := source.Login(r.Context(), cred.ClientID, cred.ClientSecret); err != nil {
		fail(w, http.StatusBadGateway, "source login failed: "+err.Error())
		return
	}
	mappings := make([]vault.Mapping, 0, len(link.Projects))
	for _, p := range link.Projects {
		mappings = append(mappings, vault.Mapping{SourceProjectID: p.SourceProjectID, LocalProjectID: p.LocalProjectID})
	}
	rep, err := vault.Import(r.Context(), source, s.Vault, u, mappings)
	s.Audit.Record(u, "link.import", link.BaseURL, err == nil, errText(err))
	if err != nil {
		fail(w, http.StatusBadGateway, err.Error())
		return
	}
	note := "ok"
	for _, p := range rep.Projects {
		if p.Error != "" {
			note = "partial"
		}
	}
	s.Store.UpdateLink(func(l *store.LinkRecord) {
		l.LastImportAt = time.Now().UTC()
		l.LastImportNote = note
	})
	writeJSON(w, http.StatusOK, rep)
}

// --- helpers ---

func linkStatus(l store.LinkRecord) map[string]any {
	out := map[string]any{
		"linked":    true,
		"source":    l.Source,
		"baseUrl":   l.BaseURL,
		"projects":  len(l.Projects),
		"createdBy": l.CreatedBy,
		"createdAt": l.CreatedAt,
	}
	if !l.LastImportAt.IsZero() {
		out["lastImportAt"] = l.LastImportAt
		out["lastImportNote"] = l.LastImportNote
	}
	return out
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, pinauth.ErrLocked):
		return http.StatusTooManyRequests
	case errors.Is(err, pinauth.ErrBadPin), errors.Is(err, pinauth.ErrNoElev):
		return http.StatusForbidden
	case errors.Is(err, pinauth.ErrNoPin), errors.Is(err, pinauth.ErrWeakPin):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		fail(w, http.StatusBadRequest, "bad json: "+err.Error())
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
