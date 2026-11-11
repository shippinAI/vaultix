package httpapi

import (
	"net/http"

	"shippin.cloud/vaultix/panel/internal/brand"
)

// getCapabilities lists every valve and whether it is open.
func (s *Server) getCapabilities(w http.ResponseWriter, _ *http.Request, _ string) {
	m := s.Valves.Manifest()
	if s.RateCap != nil {
		for i := range m {
			if m[i].Name == "rate-cap" {
				m[i].Enabled = s.RateCap.Enabled
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"owner":  brand.Owner,
		"host":   brand.Host,
		"valves": m,
	})
}
