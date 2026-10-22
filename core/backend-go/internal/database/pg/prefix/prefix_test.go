package prefix

import "testing"

func testPrefixer(t *testing.T) *Prefixer {
	t.Helper()
	p, err := New("t1", []string{
		"users",
		"organizations",
		"projects",
		"identity_metadata",
		"identity_access_tokens",
		"certificate_requests",
		"secrets_v2",
		"vaultix_migrations",
	}, []string{"on_update_timestamp"})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestNormalize(t *testing.T) {
	got, err := Normalize("acme")
	if err != nil || got != "acme_" {
		t.Fatalf("acme: %q %v", got, err)
	}
	got, err = Normalize("acme_")
	if err != nil || got != "acme_" {
		t.Fatalf("acme_: %q %v", got, err)
	}
	if got, err = Normalize(""); err != nil || got != "" {
		t.Fatalf("empty: %q %v", got, err)
	}
	if _, err = Normalize("T1"); err == nil {
		t.Fatal("expected uppercase prefix to fail")
	}
	if _, err = Normalize("abcdefghijkl"); err == nil {
		t.Fatal("expected 12-character stem to fail")
	}
}

func TestRewriteDML(t *testing.T) {
	p := testPrefixer(t)
	got := p.Rewrite(`SELECT id, name, slug, "orgId", type FROM projects WHERE slug = @slug AND "orgId" = @orgID`)
	want := `SELECT id, name, slug, "orgId", type FROM t1_projects WHERE slug = @slug AND "orgId" = @orgID`
	if got != want {
		t.Fatalf("got %s", got)
	}
	secret := p.Rewrite(`insert into "secrets_v2" ("key") values ('users_token')`)
	if secret != `insert into "t1_secrets_v2" ("key") values ('users_token')` {
		t.Fatalf("secret literal rewritten: %s", secret)
	}
	if p.Rewrite(`select * from t1_users`) != `select * from t1_users` {
		t.Fatal("double prefix")
	}
}

func TestRewriteIndexAndRoutine(t *testing.T) {
	p := testPrefixer(t)
	got := p.Rewrite(`create unique index concurrently if not exists "idx_identity_metadata_identity_id" on "identity_metadata" ("identityId")`)
	want := `create unique index concurrently if not exists "t1_idx_identity_metadata_identity_id" on "t1_identity_metadata" ("identityId")`
	if got != want {
		t.Fatalf("index: %s", got)
	}
	idx := p.Rewrite("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_identity_access_tokens_num_uses_with_limit ON identity_access_tokens (\"id\") WHERE \"accessTokenNumUses\" >= \"identity_access_tokens\".\"accessTokenNumUsesLimit\"")
	if !contains(idx, "ON t1_identity_access_tokens (") || !contains(idx, "\"t1_identity_access_tokens\".\"accessTokenNumUsesLimit\"") {
		t.Fatalf("index predicate: %s", idx)
	}
	fn := "CREATE OR REPLACE FUNCTION on_update_timestamp() RETURNS TRIGGER AS $$ BEGIN NEW.\"updatedAt\" = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;"
	rewritten := p.Rewrite(fn)
	if !contains(rewritten, "FUNCTION t1_on_update_timestamp()") || !contains(rewritten, `NEW."updatedAt"`) {
		t.Fatalf("function: %s", rewritten)
	}
}

func TestPublicQualifierBecomesUnqualified(t *testing.T) {
	p := testPrefixer(t)
	if got := p.Rewrite(`select public.users from public.users`); got != `select t1_users from t1_users` {
		t.Fatalf("qualified table: %s", got)
	}
	if got := p.Rewrite(`select "public"."users"`); got != `select "t1_users"` {
		t.Fatalf("quoted qualifier: %s", got)
	}
	cast := `AND c.confrelid = 'public.users'::regclass AND attrelid = 'users'::regclass`
	want := `AND c.confrelid = 't1_users'::regclass AND attrelid = 't1_users'::regclass`
	if got := p.Rewrite(cast); got != want {
		t.Fatalf("regclass: %s", got)
	}
	if got := p.Rewrite(`SELECT 'pg_class'::regclass`); got != `SELECT 'pg_class'::regclass` {
		t.Fatalf("catalog cast: %s", got)
	}
	if got := p.Rewrite(`select * from information_schema.tables where table_schema = current_schema()`); got != `select * from information_schema.tables where table_schema = current_schema()` {
		t.Fatalf("information_schema: %s", got)
	}
	idx := p.Rewrite(`create index "public"."idx_foo" on "users" ("id")`)
	if idx != `create index "t1_idx_foo" on "t1_users" ("id")` {
		t.Fatalf("index qualifier: %s", idx)
	}
}

func TestEmptyPrefixIsIdentity(t *testing.T) {
	p, err := New("", []string{"users"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	sql := `select * from users`
	if p.Rewrite(sql) != sql {
		t.Fatal("empty prefix changed SQL")
	}
}

func TestLoadManifest(t *testing.T) {
	p, err := Load("")
	if err != nil {
		t.Fatal(err)
	}
	if p.Prefix() != "" {
		t.Fatal("expected empty prefix")
	}
	p, err = Load("t1")
	if err != nil {
		t.Fatal(err)
	}
	if got := p.Rewrite(`select * from organizations`); got != `select * from t1_organizations` {
		t.Fatalf("manifest rewrite: %s", got)
	}
}

func contains(s, part string) bool {
	return len(s) >= len(part) && (s == part || len(part) == 0 || (func() bool { return stringIndex(s, part) >= 0 })())
}

func stringIndex(s, part string) int {
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}
