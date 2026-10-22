package httpapi

import (
	"net/http"

	"shippin.cloud/vaultix/panel/internal/manager"
	"shippin.cloud/vaultix/panel/internal/tenantprefix"
)

func (s *Server) getTenant(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, tenantprefix.FromEnv())
}

func (s *Server) getInstance(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"instance": s.Deploy,
		"license":  s.license(),
	})
}

func (s *Server) listManaged(w http.ResponseWriter, _ *http.Request, _ string) {
	if s.Manager == nil {
		writeJSON(w, http.StatusOK, map[string]any{"instances": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"instances": s.Manager.List()})
}

func (s *Server) registerManaged(w http.ResponseWriter, r *http.Request, u string) {
	if s.Manager == nil {
		fail(w, http.StatusServiceUnavailable, "manager not configured")
		return
	}
	var in struct {
		Label string `json:"label"`
		SKU   string `json:"sku"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	inst, err := s.Manager.Register(in.Label, in.SKU, string(s.license().Tier))
	s.Audit.Record(u, "manager.register", in.Label, err == nil, errText(err))
	if err != nil {
		if err == manager.ErrBadLabel {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, inst)
}

func (s *Server) managerPage(w http.ResponseWriter, r *http.Request) {
	name := "manager.html"
	if r.URL.Path != "/manager/" && r.URL.Path != "/manager" {
		s.viewportPage(w, r)
		return
	}
	s.serveAsset(w, r, name)
}
