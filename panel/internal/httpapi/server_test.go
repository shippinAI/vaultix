package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"shippin.cloud/vaultix/panel/internal/audit"
	"shippin.cloud/vaultix/panel/internal/deploy"
	"shippin.cloud/vaultix/panel/internal/instances"
	"shippin.cloud/vaultix/panel/internal/manager"
	"shippin.cloud/vaultix/panel/internal/pinauth"
	"shippin.cloud/vaultix/panel/internal/store"
	"shippin.cloud/vaultix/panel/internal/license"
	"shippin.cloud/vaultix/panel/internal/valves"
	"shippin.cloud/vaultix/panel/internal/vault"
)

const testKey = "000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f"

// fakeCore implements the verified wire surface of the pinned core
// (doc 0006): universal-auth login (flat response), /api/v1/projects
// ({project} envelope), /api/v4/secrets list/single/batch (string-enum
// bools, union write responses), /api/status.
type fakeCore struct {
	mu         sync.Mutex
	clientID   string
	envs       []string
	secrets    map[string]map[string]string // env -> key -> value
	written    int
	hideValues bool // serve secretValueHidden=true placeholders
	holdWrites bool // respond with the {approval:...} union branch
}

func (f *fakeCore) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/universal-auth/login", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ ClientId, ClientSecret string }
		json.NewDecoder(r.Body).Decode(&in)
		if in.ClientId != f.clientID {
			http.Error(w, `{"message":"bad credential"}`, http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"accessToken": "tok-" + f.clientID, "expiresIn": 3600,
			"accessTokenMaxTTL": 2592000, "tokenType": "Bearer",
		})
	})
	mux.HandleFunc("GET /api/v1/projects/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !f.authed(r) {
			http.Error(w, "no auth", http.StatusUnauthorized)
			return
		}
		type env struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Slug string `json:"slug"`
		}
		envs := []env{}
		for i, e := range f.envs {
			envs = append(envs, env{fmt.Sprintf("env-%d", i), strings.ToUpper(e), e})
		}
		json.NewEncoder(w).Encode(map[string]any{"project": map[string]any{
			"id": r.PathValue("id"), "name": "proj", "environments": envs,
		}})
	})
	mux.HandleFunc("POST /api/v1/projects", func(w http.ResponseWriter, r *http.Request) {
		if !f.authed(r) {
			http.Error(w, "no auth", http.StatusUnauthorized)
			return
		}
		var in struct {
			ProjectName string `json:"projectName"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		json.NewEncoder(w).Encode(map[string]any{"project": map[string]any{
			"id": "proj-" + in.ProjectName, "name": in.ProjectName,
		}})
	})
	mux.HandleFunc("GET /api/v4/secrets", func(w http.ResponseWriter, r *http.Request) {
		if !f.authed(r) {
			http.Error(w, "no auth", http.StatusUnauthorized)
			return
		}
		if r.URL.Query().Get("recursive") != "true" {
			// bool params are string enums upstream; anything else is a 400
			http.Error(w, `{"message":"bad recursive"}`, http.StatusBadRequest)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		type sec struct {
			SecretKey         string `json:"secretKey"`
			SecretValue       string `json:"secretValue"`
			SecretPath        string `json:"secretPath"`
			SecretValueHidden bool   `json:"secretValueHidden"`
		}
		out := []sec{}
		for k, v := range f.secrets[r.URL.Query().Get("environment")] {
			if f.hideValues {
				out = append(out, sec{k, "<hidden-by-core>", "/", true})
			} else {
				out = append(out, sec{k, v, "/", false})
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"secrets": out})
	})
	batch := func(w http.ResponseWriter, r *http.Request) {
		if !f.authed(r) {
			http.Error(w, "no auth", http.StatusUnauthorized)
			return
		}
		if f.holdWrites {
			json.NewEncoder(w).Encode(map[string]any{"approval": map[string]any{"id": "appr-1"}})
			return
		}
		var in struct {
			Environment string `json:"environment"`
			Secrets     []struct {
				SecretKey   string `json:"secretKey"`
				SecretValue string `json:"secretValue"`
			} `json:"secrets"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.store(in.Environment, func(env map[string]string) {
			for _, s := range in.Secrets {
				env[s.SecretKey] = s.SecretValue
				f.written++
			}
		})
		json.NewEncoder(w).Encode(map[string]any{"secrets": []any{}})
	}
	mux.HandleFunc("POST /api/v4/secrets/batch", batch)
	mux.HandleFunc("PATCH /api/v4/secrets/batch", batch)
	mux.HandleFunc("POST /api/v4/secrets/{name}", func(w http.ResponseWriter, r *http.Request) {
		if !f.authed(r) {
			http.Error(w, "no auth", http.StatusUnauthorized)
			return
		}
		if f.holdWrites {
			json.NewEncoder(w).Encode(map[string]any{"approval": map[string]any{"id": "appr-1"}})
			return
		}
		var in struct {
			Environment string `json:"environment"`
			SecretValue string `json:"secretValue"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.store(in.Environment, func(env map[string]string) {
			env[r.PathValue("name")] = in.SecretValue
			f.written++
		})
		json.NewEncoder(w).Encode(map[string]any{"secret": map[string]any{}})
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return mux
}

func (f *fakeCore) store(env string, fn func(map[string]string)) {
	if f.secrets == nil {
		f.secrets = map[string]map[string]string{}
	}
	if f.secrets[env] == nil {
		f.secrets[env] = map[string]string{}
	}
	fn(f.secrets[env])
}

func (f *fakeCore) authed(r *http.Request) bool {
	return r.Header.Get("Authorization") == "Bearer tok-"+f.clientID
}

type fixture struct {
	srv    *Server
	ts     *httptest.Server
	source *fakeCore
	engine *vault.Memory
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	source := &fakeCore{clientID: "source-id", envs: []string{"dev", "prod"},
		secrets: map[string]map[string]string{
			"dev":  {"OPENAI_API_KEY": "sk-dev"},
			"prod": {"OPENAI_API_KEY": "sk-prod", "DB_URL": "postgres://x"},
		}}
	sourceTS := httptest.NewServer(source.handler())
	t.Cleanup(sourceTS.Close)

	eng, err := vault.OpenMemory(testKey)
	if err != nil {
		t.Fatal(err)
	}

	regPath := filepath.Join(t.TempDir(), "instances.json")
	reg := `[{"id":"vaultix-prod","name":"Vaultix","host":"127.0.0.1","url":"self"}]`
	if err := os.WriteFile(regPath, []byte(reg), 0o600); err != nil {
		t.Fatal(err)
	}
	registry, err := instances.Load(regPath)
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(t.TempDir(), "state.json"), testKey)
	if err != nil {
		t.Fatal(err)
	}
	mgr, err := manager.Open(filepath.Join(t.TempDir(), "manager.json"))
	if err != nil {
		t.Fatal(err)
	}
	info := deploy.Info{SKU: deploy.SKUSelf, PublicHost: "127.0.0.1:8201", Owner: "AngryVibes LLC", Host: "shippin.ai", Product: "vaultix", Stamp: "A SHIPPIN.AI SERVICE"}
	_ = mgr.EnsureSelf(info, "community")
	srv := &Server{
		Store: st, Pins: pinauth.New(st), Registry: registry,
		Audit:          audit.New(""),
		Vault:          eng,
		Deploy:         info,
		Manager:        mgr,
		IdentityHeader: "X-Vaultix-Identity",
		SourceURL:      sourceTS.URL,
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return &fixture{srv: srv, ts: ts, source: source, engine: eng}
}

func (f *fixture) call(t *testing.T, method, path, user, elevated string, body any) (int, map[string]any) {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, f.ts.URL+path, rd)
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		req.Header.Set("X-Vaultix-Identity", user)
	}
	if elevated != "" {
		req.Header.Set("X-Vaultix-Elevated", elevated)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (f *fixture) elevate(t *testing.T, user string) string {
	t.Helper()
	code, out := f.call(t, "POST", "/api/v1/vaultix/session/pin", user, "",
		map[string]string{"instanceId": "vaultix-prod", "newPin": "482913"})
	if code != http.StatusOK {
		t.Fatalf("set pin: %d %v", code, out)
	}
	code, out = f.call(t, "POST", "/api/v1/vaultix/session/stepup", user, "",
		map[string]string{"instanceId": "vaultix-prod", "pin": "482913"})
	if code != http.StatusOK {
		t.Fatalf("stepup: %d %v", code, out)
	}
	return out["token"].(string)
}

func (f *fixture) link(t *testing.T, tok string) {
	t.Helper()
	code, out := f.call(t, "POST", "/api/v1/vaultix/link", "jessay", tok, map[string]any{
		"clientId": "source-id", "clientSecret": "x",
		"projects": []map[string]string{{"sourceProjectId": "cw1", "localProjectId": "lw1"}},
	})
	if code != http.StatusCreated {
		t.Fatalf("link: %d %v", code, out)
	}
}

func TestIdentityRequired(t *testing.T) {
	f := newFixture(t)
	code, _ := f.call(t, "GET", "/api/v1/vaultix/instances", "", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", code)
	}
}

func TestInstancesMetadataOnly(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "GET", "/api/v1/vaultix/instances", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	items := out["instances"].([]any)
	if len(items) != 1 {
		t.Fatalf("want 1 instance, got %d", len(items))
	}
	inst := items[0].(map[string]any)
	if inst["health"] != "ok" {
		t.Fatalf("health probe failed: %v", inst)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "sk-") || strings.Contains(string(raw), "OPENAI") {
		t.Fatal("instance list leaked secret material")
	}
}

func TestElevationGate(t *testing.T) {
	f := newFixture(t)
	box := f.seed(t, "jessay", "app", "dev", "K", "v")
	code, _ := f.call(t, "POST", "/api/v1/vaultix/inject", "jessay", "",
		map[string]string{"projectId": box, "environment": "dev", "name": "K"})
	if code != http.StatusForbidden {
		t.Fatalf("want 403 without step-up, got %d", code)
	}
	tok := f.elevate(t, "jessay")
	code, _ = f.call(t, "POST", "/api/v1/vaultix/inject", "mallory", tok,
		map[string]string{"projectId": box, "environment": "dev", "name": "K"})
	if code != http.StatusForbidden {
		t.Fatalf("want 403 for stolen token, got %d", code)
	}
	code, out := f.call(t, "POST", "/api/v1/vaultix/inject", "jessay", tok,
		map[string]string{"projectId": box, "environment": "dev", "name": "K"})
	if code != http.StatusCreated || out["handle"] == "" {
		t.Fatalf("inject: %d %v", code, out)
	}
}

func (f *fixture) seed(t *testing.T, tenant, boxName, env, name, value string) string {
	t.Helper()
	box, err := f.engine.CreateBox(t.Context(), tenant, boxName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.engine.PutSecret(t.Context(), box.ID, env, name, value, tenant); err != nil {
		t.Fatal(err)
	}
	return box.ID
}

func TestLinkAndImport(t *testing.T) {
	f := newFixture(t)
	tok := f.elevate(t, "jessay")

	code, _ := f.call(t, "POST", "/api/v1/vaultix/link", "jessay", tok, map[string]any{
		"clientId": "wrong", "clientSecret": "x",
	})
	if code != http.StatusBadGateway {
		t.Fatalf("bad cred should 502, got %d", code)
	}

	f.link(t, tok)
	code, out := f.call(t, "GET", "/api/v1/vaultix/link", "jessay", "", nil)
	if code != http.StatusOK || out["linked"] != true {
		t.Fatalf("get link: %d %v", code, out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "source-id") {
		t.Fatal("link GET leaked credential")
	}

	code, out = f.call(t, "POST", "/api/v1/vaultix/import", "jessay", tok, nil)
	if code != http.StatusOK {
		t.Fatalf("import: %d %v", code, out)
	}
	got, err := f.engine.Reveal(t.Context(), "lw1", "prod", "DB_URL")
	if err != nil || got != "postgres://x" {
		t.Fatalf("secret did not land in vaultix_* store: %q %v", got, err)
	}
	got, err = f.engine.Reveal(t.Context(), "lw1", "dev", "OPENAI_API_KEY")
	if err != nil || got != "sk-dev" {
		t.Fatalf("dev key missing: %q %v", got, err)
	}
	if f.source.written != 0 {
		t.Fatalf("import must never write to source side, wrote %d", f.source.written)
	}

	code, _ = f.call(t, "POST", "/api/v1/vaultix/import", "jessay", tok, nil)
	if code != http.StatusOK {
		t.Fatalf("re-import: %d", code)
	}
	list, err := f.engine.ListSecretMeta(t.Context(), "lw1", "prod")
	if err != nil || len(list) != 2 {
		t.Fatalf("re-import duplicated secrets: %v %v", list, err)
	}

	code, out = f.call(t, "DELETE", "/api/v1/vaultix/link", "jessay", tok, nil)
	if code != http.StatusOK || out["linked"] != false {
		t.Fatalf("unlink: %d %v", code, out)
	}
}

// A link identity without value-read permission gets placeholder values
// (secretValueHidden). Importing those would corrupt the target — the env
// must fail and nothing may be written.
func TestImportRefusesHiddenValues(t *testing.T) {
	f := newFixture(t)
	f.source.hideValues = true
	tok := f.elevate(t, "jessay")
	f.link(t, tok)

	code, out := f.call(t, "POST", "/api/v1/vaultix/import", "jessay", tok, nil)
	if code != http.StatusOK {
		t.Fatalf("import: %d %v", code, out)
	}
	if _, err := f.engine.Reveal(t.Context(), "lw1", "dev", "OPENAI_API_KEY"); err == nil {
		t.Fatal("placeholder values were written")
	}
	raw, _ := json.Marshal(out)
	if !strings.Contains(string(raw), "hidden") {
		t.Fatalf("report must name the hidden-value refusal: %s", raw)
	}
}

func TestSecretPutMetadataOnly(t *testing.T) {
	f := newFixture(t)
	tok := f.elevate(t, "jessay")
	code, box := f.call(t, "POST", "/api/v1/vaultix/projects", "jessay", tok, map[string]string{"name": "app"})
	if code != http.StatusCreated {
		t.Fatalf("box: %d %v", code, box)
	}
	id := box["projectId"].(string)
	code, out := f.call(t, "PUT", "/api/v1/vaultix/projects/"+id+"/secrets/API_KEY", "jessay", tok,
		map[string]string{"environment": "dev", "value": "super-secret-value"})
	if code != http.StatusOK {
		t.Fatalf("put: %d %v", code, out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "super-secret-value") {
		t.Fatal("secret put echoed the value back")
	}
	got, err := f.engine.Reveal(t.Context(), id, "dev", "API_KEY")
	if err != nil || got != "super-secret-value" {
		t.Fatalf("value did not land in vaultix_* store: %q %v", got, err)
	}
	code, listed := f.call(t, "GET", "/api/v1/vaultix/projects/"+id+"/secrets?environment=dev", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("list: %d %v", code, listed)
	}
	listedRaw, _ := json.Marshal(listed)
	if strings.Contains(string(listedRaw), "super-secret-value") {
		t.Fatal("list leaked the value")
	}
}

func TestInjectRedeemOneShot(t *testing.T) {
	f := newFixture(t)
	tok := f.elevate(t, "jessay")
	code, box := f.call(t, "POST", "/api/v1/vaultix/projects", "jessay", tok, map[string]string{"name": "app"})
	if code != http.StatusCreated {
		t.Fatalf("box: %d %v", code, box)
	}
	id := box["projectId"].(string)
	f.call(t, "PUT", "/api/v1/vaultix/projects/"+id+"/secrets/API_KEY", "jessay", tok,
		map[string]string{"environment": "dev", "value": "super-secret-value"})
	code, inj := f.call(t, "POST", "/api/v1/vaultix/inject", "jessay", tok,
		map[string]string{"projectId": id, "environment": "dev", "name": "API_KEY"})
	if code != http.StatusCreated {
		t.Fatalf("inject: %d %v", code, inj)
	}
	handle := inj["handle"].(string)
	code, redeemed := f.call(t, "POST", "/api/v1/vaultix/inject/"+handle+"/redeem", "", "", nil)
	if code != http.StatusOK || redeemed["value"] != "super-secret-value" {
		t.Fatalf("redeem: %d %v", code, redeemed)
	}
	code, _ = f.call(t, "POST", "/api/v1/vaultix/inject/"+handle+"/redeem", "", "", nil)
	if code != http.StatusGone {
		t.Fatalf("second redeem want 410, got %d", code)
	}
}

func TestTrustPublic(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "GET", "/api/v1/vaultix/trust", "", "", nil)
	if code != http.StatusOK {
		t.Fatalf("trust: %d %v", code, out)
	}
	if out["product"] != "Vaultix" || out["owner"] != "AngryVibes LLC" || out["trusts"] != "nomen" {
		t.Fatalf("trust payload: %v", out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(strings.ToLower(string(raw)), "vaultix") {
		t.Fatal("trust mentioned leftover brand")
	}
	if out["tier"] != string(license.Community) {
		t.Fatalf("default tier: %v", out["tier"])
	}
	if out["sku"] != deploy.SKUSelf {
		t.Fatalf("sku %v", out["sku"])
	}
}

func TestManagerNamesInstance(t *testing.T) {
	f := newFixture(t)
	tok := f.elevate(t, "jessay")
	code, out := f.call(t, "POST", "/api/v1/vaultix/manager/instances", "jessay", tok,
		map[string]string{"label": "workshop", "sku": "hosted"})
	if code != http.StatusCreated {
		t.Fatalf("register: %d %v", code, out)
	}
	if out["publicHost"] != "workshop.vaultix.shippin.cloud" {
		t.Fatalf("%v", out)
	}
	code, listed := f.call(t, "GET", "/api/v1/vaultix/manager/instances", "jessay", "", nil)
	if code != http.StatusOK {
		t.Fatalf("list: %d %v", code, listed)
	}
}

func TestLicenseEndpointAngryVibes(t *testing.T) {
	f := newFixture(t)
	code, out := f.call(t, "GET", "/api/v1/vaultix/license", "", "", nil)
	if code != http.StatusOK {
		t.Fatalf("license: %d %v", code, out)
	}
	if out["owner"] != license.Owner || out["host"] != license.Host || out["product"] != license.Product {
		t.Fatalf("%v", out)
	}
	if out["tier"] != string(license.Community) {
		t.Fatalf("tier %v", out["tier"])
	}
}

func TestCommunityCannotHoldForApproval(t *testing.T) {
	f := newFixture(t)
	f.srv.Valves.ApprovalGate = valves.ApprovalGate{Enabled: true}
	tok := f.elevate(t, "jessay")
	code, box := f.call(t, "POST", "/api/v1/vaultix/projects", "jessay", tok, map[string]string{"name": "app"})
	if code != http.StatusCreated {
		t.Fatalf("box: %d %v", code, box)
	}
	id := box["projectId"].(string)
	code, out := f.call(t, "PUT", "/api/v1/vaultix/projects/"+id+"/secrets/API_KEY", "jessay", tok,
		map[string]string{"environment": "dev", "value": "v"})
	if code != http.StatusOK {
		t.Fatalf("community must apply, not hold: %d %v", code, out)
	}
}
