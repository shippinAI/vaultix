package deviceauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/device"
)

const Path = "/api/v1/vaultix/auth/device"

type Grants interface {
	Start(context.Context, device.Request) (device.Grant, error)
	Inspect(context.Context, string) (device.Info, error)
	Approve(context.Context, string, *auth.Identity) error
	Deny(context.Context, string) error
	Cancel(context.Context, device.Request, string) error
	Poll(context.Context, device.Request, string) (device.Session, error)
}

type Sessions interface {
	Renew(context.Context, device.Request, string) (device.Session, error)
	Revoke(context.Context, device.Request, string) error
}

type Limiter interface {
	Allow(context.Context, string, string) (bool, error)
}

type Deps struct {
	Grants      Grants
	Sessions    Sessions
	Limiter     Limiter
	Resource    string
	BrowserAuth func(http.Handler) http.Handler
}

type Handler struct {
	grants      Grants
	sessions    Sessions
	limiter     Limiter
	resource    string
	origin      string
	browserAuth func(http.Handler) http.Handler
}

func NewHandler(deps *Deps) (*Handler, error) {
	if deps == nil || deps.Grants == nil || deps.Sessions == nil || deps.Limiter == nil || deps.BrowserAuth == nil {
		return nil, device.ErrUnavailable
	}
	u, err := url.Parse(deps.Resource)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery || strings.HasSuffix(deps.Resource, "/") {
		return nil, device.ErrUnavailable
	}
	if u.Scheme == "http" {
		ip, parseErr := netip.ParseAddr(u.Hostname())
		if parseErr != nil || !ip.IsLoopback() {
			return nil, device.ErrUnavailable
		}
	} else if u.Scheme != "https" {
		return nil, device.ErrUnavailable
	}
	return &Handler{grants: deps.Grants, sessions: deps.Sessions, limiter: deps.Limiter, resource: deps.Resource, origin: u.Scheme + "://" + u.Host, browserAuth: deps.BrowserAuth}, nil
}

func (h *Handler) Register(router chi.Router) {
	router.Route(Path, func(r chi.Router) {
		r.Use(h.boundary)
		r.Post("/authorize", h.start)
		r.Post("/token", h.token)
		r.Post("/cancel", h.cancel)
		r.Post("/revoke", h.revoke)
		r.Group(func(r chi.Router) {
			r.Use(h.browserAuth)
			r.Use(h.browser)
			r.Post("/inspect", h.inspect)
			r.Post("/decision", h.decide)
		})
	})
}

func (h *Handler) boundary(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		operation := strings.TrimPrefix(r.URL.Path, Path)
		switch operation {
		case "/authorize", "/token", "/cancel", "/revoke", "/inspect", "/decision":
		default:
			respond(w, http.StatusNotFound, map[string]string{"error": "invalid_request"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "invalid_request"})
			return
		}
		if r.URL.RawQuery != "" || r.URL.ForceQuery || len(r.UserAgent()) > 255 {
			fail(w, device.ErrInvalidRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		// Native listeners are private. The trusted application ingress replaces
		// X-Real-IP; never use a client-supplied X-Forwarded-For chain here.
		peer := r.Header.Get("X-Real-IP")
		if peer == "" {
			var err error
			peer, _, err = net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				fail(w, device.ErrInvalidRequest)
				return
			}
		}
		ip, err := netip.ParseAddr(peer)
		if err != nil {
			fail(w, device.ErrInvalidRequest)
			return
		}
		allowed, err := h.limiter.Allow(ctx, operation, ip.Unmap().String())
		if err != nil {
			fail(w, device.ErrUnavailable)
			return
		}
		if !allowed {
			w.Header().Set("Retry-After", "60")
			respond(w, http.StatusTooManyRequests, map[string]string{"error": "slow_down"})
			return
		}
		ctx = auth.WithHTTPInfo(ctx, &auth.HTTPInfo{IPAddress: ip.Unmap().String(), UserAgent: r.UserAgent(), UserAgentType: "cli"})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *Handler) browser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor, err := auth.IdentityFromContext(r.Context())
		if err != nil || actor == nil || actor.Actor != auth.ActorTypeUser || actor.AuthMode != auth.AuthModeJWT || auth.AssumedPrivilegeFromContext(r.Context()) != nil || r.Header.Get("Origin") != h.origin {
			respond(w, http.StatusForbidden, map[string]string{"error": "access_denied"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Read the body alone: ParseForm would merge query parameters and hide duplicate
// security parameters behind Values.Get. No input or credential enters errors.
func form(w http.ResponseWriter, r *http.Request, allowed ...string) (url.Values, error) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/x-www-form-urlencoded" {
		return nil, device.ErrInvalidRequest
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil {
		return nil, device.ErrInvalidRequest
	}
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return nil, device.ErrInvalidRequest
	}
	for key, entries := range values {
		known := false
		for _, name := range allowed {
			if key == name {
				known = true
				break
			}
		}
		if !known || len(entries) != 1 || entries[0] == "" {
			return nil, device.ErrInvalidRequest
		}
	}
	return values, nil
}

func request(values url.Values) device.Request {
	return device.Request{ClientID: values.Get("client_id"), Resource: values.Get("resource"), Scope: values.Get("scope")}
}

func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	v, err := form(w, r, "client_id", "resource", "scope")
	if err != nil {
		fail(w, err)
		return
	}
	grant, err := h.grants.Start(r.Context(), request(v))
	if err != nil {
		fail(w, err)
		return
	}
	seconds := int(time.Until(grant.ExpiresAt).Seconds())
	if seconds < 1 {
		fail(w, device.ErrExpired)
		return
	}
	if seconds > int(device.Lifetime.Seconds()) {
		seconds = int(device.Lifetime.Seconds())
	}
	respond(w, http.StatusOK, map[string]any{"device_code": grant.DeviceCode, "user_code": grant.UserCode, "verification_uri": h.resource + "/login/device", "expires_in": seconds, "interval": int(grant.Interval.Seconds())})
}

func (h *Handler) token(w http.ResponseWriter, r *http.Request) {
	v, err := form(w, r, "client_id", "resource", "scope", "grant_type", "device_code", "refresh_token")
	if err != nil {
		fail(w, err)
		return
	}
	var session device.Session
	switch v.Get("grant_type") {
	case "urn:ietf:params:oauth:grant-type:device_code":
		if v.Get("device_code") == "" || v.Has("refresh_token") {
			fail(w, device.ErrInvalidRequest)
			return
		}
		session, err = h.grants.Poll(r.Context(), request(v), v.Get("device_code"))
	case "refresh_token":
		if v.Get("refresh_token") == "" || v.Has("device_code") {
			fail(w, device.ErrInvalidRequest)
			return
		}
		session, err = h.sessions.Renew(r.Context(), request(v), v.Get("refresh_token"))
	default:
		respond(w, http.StatusBadRequest, map[string]string{"error": "unsupported_grant_type"})
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"access_token": session.AccessToken, "refresh_token": session.RefreshToken, "token_type": "Bearer", "expires_in": int(session.ExpiresIn.Seconds()), "scope": device.Scope})
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	v, err := form(w, r, "client_id", "resource", "scope", "device_code")
	if err == nil {
		err = h.grants.Cancel(r.Context(), request(v), v.Get("device_code"))
	}
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"canceled": true})
}

func (h *Handler) revoke(w http.ResponseWriter, r *http.Request) {
	v, err := form(w, r, "client_id", "resource", "scope", "token")
	if err == nil {
		err = h.sessions.Revoke(r.Context(), request(v), v.Get("token"))
	}
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"revoked": true})
}

func (h *Handler) inspect(w http.ResponseWriter, r *http.Request) {
	v, err := form(w, r, "user_code")
	if err != nil {
		fail(w, err)
		return
	}
	info, err := h.grants.Inspect(r.Context(), v.Get("user_code"))
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"client_name": info.ClientName, "resource": info.Resource, "scope": info.Scope, "expires_at": info.ExpiresAt})
}

func (h *Handler) decide(w http.ResponseWriter, r *http.Request) {
	v, err := form(w, r, "user_code", "decision")
	if err != nil {
		fail(w, err)
		return
	}
	actor, err := auth.IdentityFromContext(r.Context())
	if err != nil {
		fail(w, device.ErrDenied)
		return
	}
	switch v.Get("decision") {
	case "approve":
		err = h.grants.Approve(r.Context(), v.Get("user_code"), actor)
	case "deny":
		err = h.grants.Deny(r.Context(), v.Get("user_code"))
	default:
		err = device.ErrInvalidRequest
	}
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]string{"decision": v.Get("decision")})
}

func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func fail(w http.ResponseWriter, err error) {
	code, status := "server_error", http.StatusServiceUnavailable
	switch {
	case errors.Is(err, device.ErrInvalidRequest):
		code, status = "invalid_request", http.StatusBadRequest
	case errors.Is(err, device.ErrInvalidGrant), errors.Is(err, device.ErrInvalidCredential):
		code, status = "invalid_grant", http.StatusBadRequest
	case errors.Is(err, device.ErrPending):
		code, status = "authorization_pending", http.StatusBadRequest
	case errors.Is(err, device.ErrSlowDown):
		code, status = "slow_down", http.StatusBadRequest
	case errors.Is(err, device.ErrDenied):
		code, status = "access_denied", http.StatusBadRequest
	case errors.Is(err, device.ErrExpired):
		code, status = "expired_token", http.StatusBadRequest
	}
	respond(w, status, map[string]string{"error": code})
}
