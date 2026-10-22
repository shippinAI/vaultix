package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"shippin.cloud/vaultix/panel/internal/mcp"
	"shippin.cloud/vaultix/panel/internal/runtime"
	"shippin.cloud/vaultix/panel/internal/source"
	"shippin.cloud/vaultix/panel/internal/viewport"
	viewportweb "shippin.cloud/vaultix/panel/internal/viewport/web"
)

func (s *Server) getCatalog(w http.ResponseWriter, _ *http.Request, _ string) {
	writeJSON(w, http.StatusOK, map[string]any{
		"catalogId": runtime.KnowledgeCatalogID,
		"version":   runtime.KnowledgeCatalogVer,
		"a2ui":      runtime.A2UIVersion,
		"entries":   runtime.Catalog(),
		"components": allowedComponentList(),
	})
}

func (s *Server) getViewport(w http.ResponseWriter, r *http.Request, _ string) {
	writeJSON(w, http.StatusOK, viewport.Compose(r.URL.Query().Get("route")))
}

func (s *Server) runtimeAnswer(w http.ResponseWriter, r *http.Request, _ string) {
	var in runtime.Trigger
	if !readJSON(w, r, &in) {
		return
	}
	surface := r.URL.Query().Get("surface")
	writeJSON(w, http.StatusOK, runtime.Decide(surface, in, runtime.DecideOpts{}))
}

func (s *Server) configureShow(w http.ResponseWriter, r *http.Request, _ string) {
	idx, _ := strconv.Atoi(r.URL.Query().Get("index"))
	idx = runtime.ClampIndex(idx)
	writeJSON(w, http.StatusOK, map[string]any{
		"index":    idx,
		"step":     runtime.Path()[idx],
		"messages": runtime.Show(idx),
	})
}

func (s *Server) mcpRPC(w http.ResponseWriter, r *http.Request, u string) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		fail(w, http.StatusBadRequest, "bad body")
		return
	}
	var peek struct {
		Method string `json:"method"`
		Params struct {
			Name string `json:"name"`
		} `json:"params"`
	}
	_ = json.Unmarshal(raw, &peek)
	if peek.Method == "tools/call" && peek.Params.Name == "vaultix.source.act" {
		if _, err := s.Pins.Check(u, r.Header.Get("X-Vaultix-Elevated")); err != nil {
			writeJSON(w, http.StatusOK, mcp.Response{
				JSONRPC: "2.0",
				Error:   &mcp.Error{Code: -32000, Message: "step-up required: POST /api/v1/vaultix/session/stepup"},
			})
			return
		}
	}
	srv := &mcp.Server{Ops: sourceOps{s: s, user: u}, User: u}
	res := srv.Handle(r.Context(), raw)
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) mcpManifest(w http.ResponseWriter, _ *http.Request, _ string) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name": "vaultix", "protocol": mcp.ProtocolVersion,
		"tools": mcp.Tools(),
		"note":  "Tools are the catalog, viewport, configure path, and source actions. Not a leftover wrap.",
	})
}

func (s *Server) brandFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		name = "favicon.svg"
	}
	s.serveAsset(w, r, name)
}

func (s *Server) welcomePage(w http.ResponseWriter, r *http.Request) {
	s.serveAsset(w, r, "welcome.html")
}

func (s *Server) viewportPage(w http.ResponseWriter, r *http.Request) {
	name := strings.Trim(strings.TrimPrefix(r.URL.Path, "/viewport/"), "/")
	if name == "" {
		name = "index.html"
	}
	s.serveAsset(w, r, name)
}

func (s *Server) serveAsset(w http.ResponseWriter, r *http.Request, name string) {
	if strings.Contains(name, "..") || strings.Contains(name, "/") {
		http.NotFound(w, r)
		return
	}
	b, err := viewportweb.Files.ReadFile(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ctype := "text/plain; charset=utf-8"
	switch {
	case strings.HasSuffix(name, ".html"):
		ctype = "text/html; charset=utf-8"
	case strings.HasSuffix(name, ".js"):
		ctype = "text/javascript; charset=utf-8"
	case strings.HasSuffix(name, ".svg"):
		ctype = "image/svg+xml"
	case strings.HasSuffix(name, ".css"):
		ctype = "text/css; charset=utf-8"
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Content-Type", ctype)
	_, _ = w.Write(b)
}

func allowedComponentList() []string {
	out := make([]string, 0, len(runtime.AllowedComponents))
	for k := range runtime.AllowedComponents {
		out = append(out, k)
	}
	return out
}

var _ source.Ops = sourceOps{}
