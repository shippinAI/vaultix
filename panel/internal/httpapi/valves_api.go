package httpapi

import (
	"net/http"

	"shippin.cloud/vaultix/panel/internal/license"
)

// getCapabilities lists every valve, whether the grant licenses it, and
// whether it is actually open. Env flags cannot open an unlicensed valve.
func (s *Server) getCapabilities(w http.ResponseWriter, _ *http.Request, _ string) {
	g := s.license()
	m := s.Valves.Manifest()
	if s.RateCap != nil {
		for i := range m {
			if m[i].Name == "rate-cap" {
				m[i].Enabled = s.RateCap.Enabled
			}
		}
	}
	for i := range m {
		m[i].Requires = string(license.Requires(m[i].Name))
		m[i].Licensed = g.Allows(m[i].Name)
		if m[i].Enabled && !m[i].Licensed {
			m[i].Enabled = false
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"owner":  license.Owner,
		"host":   license.Host,
		"tier":   g.Tier,
		"valves": m,
	})
}
