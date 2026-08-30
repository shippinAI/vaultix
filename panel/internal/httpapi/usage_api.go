package httpapi

import (
	"context"
	"net/http"

	"shippin.cloud/vaultix/panel/internal/usage"
)

// snapshot gathers current per-feature counts. Metadata only — counts, never
// secret values. Counts are wired per-feature as each panel view lands
// (doc 0010 backlog); until a feature has a cheap count it reports 0. The
// meter capability (plan, limits, enforcement valve) is complete regardless.
func (s *Server) snapshot(_ context.Context) usage.Snapshot {
	return usage.Snapshot{}
}

// getUsage serves the meter view (doc 0010, gaps-4): every feature with used
// vs limit, plus whether enforcement is on. Purely observational unless the
// operator opted into enforcement. Available to any authenticated identity.
func (s *Server) getUsage(w http.ResponseWriter, r *http.Request, _ string) {
	plan := s.Meter.Plan
	if plan.Limits == nil {
		plan = usage.Unlimited()
	}
	report := usage.Report(plan, s.snapshot(r.Context()))
	writeJSON(w, http.StatusOK, map[string]any{
		"plan":     plan.Name,
		"enforced": s.Meter.Enforce,
		"features": report,
	})
}
