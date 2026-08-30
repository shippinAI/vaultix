// vaultix — Shippin secrets overlay. Engine is core/. Trusts Nomen.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"shippin.cloud/vaultix/panel/internal/audit"
	"shippin.cloud/vaultix/panel/internal/deploy"
	"shippin.cloud/vaultix/panel/internal/httpapi"
	"shippin.cloud/vaultix/panel/internal/instances"
	"shippin.cloud/vaultix/panel/internal/license"
	"shippin.cloud/vaultix/panel/internal/manager"
	"shippin.cloud/vaultix/panel/internal/mcp"
	"shippin.cloud/vaultix/panel/internal/nomen"
	"shippin.cloud/vaultix/panel/internal/pinauth"
	"shippin.cloud/vaultix/panel/internal/store"
	"shippin.cloud/vaultix/panel/internal/usage"
	"shippin.cloud/vaultix/panel/internal/valves"
	"shippin.cloud/vaultix/panel/internal/vault"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := parts[:0]
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func atoiOr0(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

func main() {
	mcpMode := len(os.Args) > 1 && os.Args[1] == "mcp"
	listen := env("VAULTIX_PANEL_LISTEN", "127.0.0.1:8201")
	statePath := env("VAULTIX_PANEL_STATE", "/var/lib/vaultix-panel/state.json")
	registryPath := env("VAULTIX_PANEL_REGISTRY", "/etc/vaultix-panel/instances.json")
	auditPath := env("VAULTIX_PANEL_AUDIT", "/var/lib/vaultix-panel/audit.jsonl")

	encKey := os.Getenv("VAULTIX_ENC_KEY")
	if encKey == "" {
		encKey = os.Getenv("VAULTIX_PANEL_ENC_KEY")
	}
	if encKey == "" {
		log.Fatal("VAULTIX_ENC_KEY required (64 hex chars; escrow it with the instance keys)")
	}
	st, err := store.Open(statePath, encKey)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	reg, err := instances.Load(registryPath)
	if err != nil {
		log.Fatalf("registry: %v", err)
	}

	localURL := os.Getenv("VAULTIX_LOCAL_URL")
	var eng vault.Engine
	dbURL := os.Getenv("VAULTIX_DATABASE_URL")
	if localURL == "" && dbURL == "" && !mcpMode {
		log.Fatal("VAULTIX_LOCAL_URL (owned core/) or VAULTIX_DATABASE_URL (overlay/test fallback) required")
	}
	if dbURL != "" {
		var err error
		eng, err = vault.OpenPostgres(context.Background(), dbURL, encKey)
		if err != nil {
			log.Fatalf("overlay vault: %v", err)
		}
	}

	var nomenV *nomen.Verifier
	if iss := os.Getenv("NOMEN_OIDC_ISSUER"); iss != "" {
		nomenV = &nomen.Verifier{
			Issuer:   strings.TrimRight(iss, "/"),
			Audience: env("VAULTIX_NOMEN_AUDIENCE", "vaultix"),
			JWKSURL:  os.Getenv("NOMEN_JWKS_URL"),
		}
	}

	lic := license.Load(os.Getenv("VAULTIX_LICENSE_TIER"), os.Getenv("VAULTIX_LICENSE_FILE"), os.Getenv("VAULTIX_LICENSE_SUBJECT"))
	info := deploy.Load()
	mgrPath := os.Getenv("VAULTIX_MANAGER_STATE")
	if mgrPath == "" {
		mgrPath = filepath.Join(filepath.Dir(statePath), "manager.json")
	}
	mgr, err := manager.Open(mgrPath)
	if err != nil {
		log.Fatalf("manager: %v", err)
	}
	if err := mgr.EnsureSelf(info, string(lic.Tier)); err != nil {
		log.Fatalf("manager self: %v", err)
	}

	srv := &httpapi.Server{
		Store:          st,
		Pins:           pinauth.New(st),
		Registry:       reg,
		Audit:          audit.New(auditPath),
		Vault:          eng,
		Nomen:          nomenV,
		License:        lic,
		Deploy:         info,
		Manager:        mgr,
		IdentityHeader: env("VAULTIX_PANEL_IDENTITY_HEADER", "X-Vaultix-Identity"),
		SourceURL:      os.Getenv("VAULTIX_SOURCE_URL"),
		Local: struct{ URL, ClientID, ClientSecret string }{
			URL: os.Getenv("VAULTIX_LOCAL_URL"), ClientID: os.Getenv("VAULTIX_LOCAL_CLIENT_ID"),
			ClientSecret: os.Getenv("VAULTIX_LOCAL_CLIENT_SECRET"),
		},
		Meter: usage.Meter{
			Plan:    usage.Unlimited(),
			Enforce: lic.Open(license.FeatMeter, os.Getenv("VAULTIX_METER_ENFORCE") == "true"),
		},
		Valves: valves.Set{
			IPAllowlist:  valves.NewIPAllowlist(lic.Open(license.FeatIPAllowlist, os.Getenv("VAULTIX_IP_ALLOWLIST") != ""), splitCSV(os.Getenv("VAULTIX_IP_ALLOWLIST"))),
			ApprovalGate: valves.ApprovalGate{Enabled: lic.Open(license.FeatApproval, os.Getenv("VAULTIX_APPROVAL_GATE") == "true")},
			AuditStream:  valves.AuditStream{Enabled: lic.Open(license.FeatAuditStream, os.Getenv("VAULTIX_AUDIT_STREAM_URL") != ""), Endpoint: os.Getenv("VAULTIX_AUDIT_STREAM_URL")},
			AccessPolicy: valves.AccessPolicy{Enabled: lic.Open(license.FeatAccessPolicy, os.Getenv("VAULTIX_ACCESS_POLICY_DENY") != ""), Deny: splitCSV(os.Getenv("VAULTIX_ACCESS_POLICY_DENY"))},
		},
		RateCap: valves.NewRateCap(lic.Open(license.FeatRateCap, os.Getenv("VAULTIX_RATE_CAP_PER_MIN") != ""), atoiOr0(os.Getenv("VAULTIX_RATE_CAP_PER_MIN"))),
	}
	if u := os.Getenv("VAULTIX_AUDIT_STREAM_URL"); u != "" && srv.Valves.AuditStream.Enabled {
		srv.Audit = srv.Audit.WithStream(u)
	}

	if mcpMode {
		log.Printf("vaultix mcp stdio (catalog-first, A2UI, no leftover wrap)")
		serveMCPStdio(&mcp.Server{User: "mcp"})
		return
	}

	log.Printf("vaultix listening on %s (sku %s host %s, %s, tier %s)", listen, info.SKU, info.PublicHost, license.Owner, lic.Tier)
	log.Fatal(http.ListenAndServe(listen, srv.Handler()))
}

func serveMCPStdio(s *mcp.Server) {
	in := bufio.NewReader(os.Stdin)
	for {
		line, err := in.ReadBytes('\n')
		if len(line) > 0 {
			res := s.Handle(context.Background(), line)
			enc := json.NewEncoder(os.Stdout)
			if err := enc.Encode(res); err != nil {
				return
			}
		}
		if err != nil {
			if err != io.EOF {
				log.Printf("mcp stdin: %v", err)
			}
			return
		}
	}
}
