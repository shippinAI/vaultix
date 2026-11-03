package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"shippin.cloud/vaultix/internal/release"
)

const fakeDockerRecord = "DOCKER_VAULTIX_TEST_RECORD"

// The test binary stands in for Docker. Only DOCKER_ variables pass the real
// command environment, so this runs exactly when a test selected it.
func init() {
	record := os.Getenv(fakeDockerRecord)
	if record == "" {
		return
	}
	args := os.Args[1:]
	input := ""
	if len(args) > 0 && args[0] == "create" {
		raw, _ := io.ReadAll(os.Stdin)
		input = string(raw)
	}
	entry, _ := json.Marshal(map[string]any{"args": args, "stdin": input})
	f, err := os.OpenFile(record, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		os.Exit(90)
	}
	fmt.Fprintf(f, "%s\n", entry)
	f.Close()
	switch args[0] {
	case "container":
		running := os.Getenv("DOCKER_VAULTIX_TEST_RUNNING")
		if running == "" {
			os.Exit(1)
		}
		fmt.Printf(`[{"Id":%q,"Config":{"Labels":{"vaultix.lifecycle.operation":"op-test","vaultix.lifecycle.role":%q}},"State":{"Running":true}}]`, strings.Repeat("f", 64), running)
	case "create":
		fmt.Print(strings.Repeat("a", 64))
	case "wait":
		fmt.Print(os.Getenv("DOCKER_VAULTIX_TEST_EXIT"))
	case "logs":
		fmt.Fprintln(os.Stderr, "PRIVATE-MIGRATION-OUTPUT")
	}
	os.Exit(0)
}

func fakeDocker(t *testing.T, exit, running string) (*Docker, func() []string) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := privateTemp(t)
	record := filepath.Join(root, "docker-record")
	t.Setenv(fakeDockerRecord, record)
	t.Setenv("DOCKER_VAULTIX_TEST_EXIT", exit)
	t.Setenv("DOCKER_VAULTIX_TEST_RUNNING", running)
	return &Docker{executable: executable, root: root}, func() []string {
		raw, err := os.ReadFile(record)
		if err != nil {
			t.Fatal(err)
		}
		return strings.Split(strings.TrimSpace(string(raw)), "\n")
	}
}

func TestApplyMigrationsKeepsValuesOutOfArgumentsAndDiagnostics(t *testing.T) {
	const secret = "PRIVATE-ENCRYPTION-KEY"
	d, calls := fakeDocker(t, "3", "")
	s := fixtureState()
	err := d.applyMigrations(context.Background(), &s, "rehearsal", "container:probe", map[string]string{"ENCRYPTION_KEY": secret})
	if err == nil || !strings.Contains(err.Error(), "exited 3") {
		t.Fatalf("a failed migration was not reported: %v", err)
	}
	if strings.Contains(err.Error(), "PRIVATE-MIGRATION-OUTPUT") {
		t.Fatal("migration output reached diagnostics")
	}
	piped := false
	for _, call := range calls() {
		var entry struct {
			Args  []string
			Stdin string
		}
		if json.Unmarshal([]byte(call), &entry) != nil {
			t.Fatal("unreadable fake Docker record")
		}
		if strings.Contains(strings.Join(entry.Args, " "), secret) {
			t.Fatal("a setting value reached Docker arguments")
		}
		piped = piped || strings.Contains(entry.Stdin, "ENCRYPTION_KEY="+secret)
	}
	if !piped {
		t.Fatal("the application setting did not reach the container")
	}
	logs, err := filepath.Glob(filepath.Join(d.root, "op-test-rehearsal-*.log"))
	if err != nil || len(logs) != 1 {
		t.Fatalf("expected one private migration log, found %v", logs)
	}
	raw, err := privateRead(logs[0], 4096)
	if err != nil || !strings.Contains(string(raw), "PRIVATE-MIGRATION-OUTPUT") {
		t.Fatal("migration output was not kept in the private log")
	}
}

func TestInterruptedLiveMigrationFinishesBeforeRetry(t *testing.T) {
	for role, waits := range map[string]bool{"migrate": true, "rehearsal": false} {
		d, calls := fakeDocker(t, "0", role)
		s := fixtureState()
		if err := d.applyMigrations(context.Background(), &s, role, "network", map[string]string{}); err != nil {
			t.Fatal(err)
		}
		var order []string
		for _, call := range calls() {
			var entry struct{ Args []string }
			if json.Unmarshal([]byte(call), &entry) != nil {
				t.Fatal("unreadable fake Docker record")
			}
			order = append(order, entry.Args[0])
		}
		got := strings.Join(order, " ")
		if waits && !strings.HasPrefix(got, "container wait logs rm create") {
			t.Fatalf("a running live migration must finish, and its output be kept, before it is removed: %s", got)
		}
		if !waits && !strings.HasPrefix(got, "container logs rm create") {
			t.Fatalf("a disposable rehearsal should keep its output and be discarded at once: %s", got)
		}
	}
}

func TestRehearsalOutcomeKeepsAnInterruptForTheOperator(t *testing.T) {
	cause := errors.New("cause")
	var refused *rehearsalError
	if !errors.As(rehearsalOutcome(context.Background(), cause), &refused) || refused.cause != cause {
		t.Fatal("a failed rehearsal must return the previous application")
	}
	expired, cancelExpired := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelExpired()
	if err := rehearsalOutcome(expired, cause); !errors.As(err, &refused) || !strings.Contains(err.Error(), "time limit") {
		t.Fatalf("the time limit must return the previous application and say why: %v", err)
	}
	interrupted, cancel := context.WithCancel(context.Background())
	cancel()
	if err := rehearsalOutcome(interrupted, cause); errors.As(err, &refused) {
		t.Fatal("an interrupt must leave the saved operation for the operator")
	}
}

func TestChangedMigrationsNeedALinuxBinary(t *testing.T) {
	if migrationHost("linux") != nil || migrationHost("windows") == nil {
		t.Fatal("a Windows binary must refuse at planning, before the application stops")
	}
}

func manifest(set string, files map[string]string) migrationManifest {
	return migrationManifest{Set: strings.Repeat(set, 64), Files: files}
}

func TestPlanMigration(t *testing.T) {
	a, b, c := strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)
	prior := manifest("1", map[string]string{"001.mjs": a, "002.mjs": b})
	forward := manifest("2", map[string]string{"001.mjs": a, "002.mjs": b, "004.mjs": c, "003.mjs": c})
	applied := []string{"001.mjs", "002.mjs"}

	plan, err := planMigration(prior, prior, applied)
	if err != nil || plan != nil {
		t.Fatal("an unchanged set needs no plan")
	}
	plan, err = planMigration(prior, forward, applied)
	if err != nil || plan == nil || strings.Join(plan.Pending, ",") != "003.mjs,004.mjs" || plan.From != prior.Set || plan.Applied != appliedDigest(applied) {
		t.Fatalf("forward plan wrong: %+v %v", plan, err)
	}
	if err = plan.validate(); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]migrationManifest{
		"altered history": manifest("3", map[string]string{"001.mjs": c, "002.mjs": b, "003.mjs": c}),
		"store ahead":     manifest("4", map[string]string{"001.mjs": a, "003.mjs": c}),
	} {
		if plan, err = planMigration(prior, target, applied); err == nil || plan != nil {
			t.Fatalf("%s must be refused", name)
		}
	}
	// A store already holding every candidate migration has nothing to apply.
	plan, err = planMigration(prior, forward, []string{"001.mjs", "002.mjs", "003.mjs", "004.mjs"})
	if err != nil || plan != nil {
		t.Fatalf("nothing pending should need no plan: %+v %v", plan, err)
	}
	// An unapplied file the candidate dropped is not a reason to refuse.
	dropped := manifest("5", map[string]string{"001.mjs": a, "003.mjs": c})
	if plan, err = planMigration(prior, dropped, []string{"001.mjs"}); err != nil || plan == nil {
		t.Fatalf("a candidate only has to cover what the store applied: %v", err)
	}
}

func TestMigrationTopologyRefusesWhatTheCheckpointCannotCover(t *testing.T) {
	if err := migrationTopology(map[string]string{"GENERATE_SANITIZED_SCHEMA": "false"}); err != nil {
		t.Fatal(err)
	}
	for _, env := range []map[string]string{{"AUDIT_LOGS_DB_CONNECTION_URI": "postgres://audit"}, {"GENERATE_SANITIZED_SCHEMA": "true"}} {
		if migrationTopology(env) == nil {
			t.Fatalf("%v must be refused", env)
		}
	}
}

func TestMigrationEnvironmentFile(t *testing.T) {
	raw, err := migrationEnvironmentFile(map[string]string{"Z_KEY": "b=c #d", "A_KEY": "", "M_KEY": `"quoted"`})
	if err != nil || string(raw) != "A_KEY=\nM_KEY=\"quoted\"\nZ_KEY=b=c #d\n" {
		t.Fatalf("environment file changed values: %q %v", raw, err)
	}
	for _, env := range []map[string]string{{"KEY": "a\nb"}, {"KEY": "a\rb"}, {"BAD KEY": "a"}, {"#KEY": "a"}} {
		if _, err = migrationEnvironmentFile(env); err == nil {
			t.Fatalf("%v must be refused rather than altered", env)
		}
	}
}

func upgradeFixture(phase string, migration bool) *State {
	prior := Candidate{Image: "sha256:" + strings.Repeat("1", 64), Revision: strings.Repeat("c", 40), Migrations: strings.Repeat("d", 64), Evidence: strings.Repeat("e", 64), Trust: "existing-instance"}
	s := fixtureState()
	s.Action, s.Phase = "upgrade", phase
	s.Prior = &prior
	s.PriorImage, s.PriorContainer = prior.Image, strings.Repeat("9", 64)
	s.Database, s.DatabaseImage, s.DatabaseVolume, s.Cache = strings.Repeat("8", 64), "sha256:"+strings.Repeat("7", 64), "data", strings.Repeat("0", 64)
	s.Backup, s.BackupHash, s.EnvironmentHash = "op-test-1.database.age", strings.Repeat("6", 64), strings.Repeat("5", 64)
	if migration {
		s.Migration = &MigrationPlan{From: prior.Migrations, Applied: strings.Repeat("4", 64), Pending: []string{"001.mjs"}, Secrets: strings.Repeat("3", 64)}
	}
	return &s
}

func TestRollbackEligibility(t *testing.T) {
	for _, tc := range []struct {
		phase              string
		migration, consent bool
		allowed, restores  bool
	}{
		{"planned", true, false, true, false},
		{"stopping", true, false, true, false},
		{"snapshot", true, false, true, false},
		{"rehearsing", true, false, true, false},
		// The candidate has not run, but an application started by hand may have written.
		{"migrating", true, false, false, true},
		{"migrating", true, true, true, true},
		{"replacing", true, false, false, true},
		{"validating", true, false, false, true},
		{"ready", true, false, false, true},
		{"replacing", true, true, true, true},
		{"validating", true, true, true, true},
		{"ready", true, true, true, true},
		// Without a schema change the previous image reads the same store.
		{"replacing", false, false, true, false},
		{"validating", false, false, true, false},
		{"ready", false, false, true, false},
	} {
		name := fmt.Sprintf("%s migration=%v consent=%v", tc.phase, tc.migration, tc.consent)
		s := upgradeFixture(tc.phase, tc.migration)
		next, err := rollbackState(s, tc.consent)
		if tc.allowed != (err == nil) {
			t.Fatalf("%s: allowed=%v err=%v", name, tc.allowed, err)
		}
		if err != nil {
			continue
		}
		if next.Candidate.Image != s.Prior.Image || next.Reverted.Image != s.Candidate.Image || next.RevertedFrom != tc.phase || next.Prior != nil {
			t.Fatalf("%s: rollback does not target the previous application", name)
		}
		if got := liveStoreChanged(next.Migration, next.RevertedFrom); got != tc.restores {
			t.Fatalf("%s: restores=%v", name, got)
		}
		next.SchemaVersion, next.Sequence, next.UpdatedAt = Schema, 2, "2026-11-03T00:00:00Z"
		next.Previous, next.Phase = strings.Repeat("2", 64), "reverting"
		if err = next.validate(); err != nil {
			t.Fatalf("%s: rollback state does not validate: %v", name, err)
		}
	}
}

func TestRollbackRefusals(t *testing.T) {
	for name, s := range map[string]func() *State{
		"install":         func() *State { i := fixtureState(); i.Phase = "ready"; return &i },
		"older CLI state": func() *State { s := upgradeFixture("validating", false); s.Prior = nil; return s },
		"same image":      func() *State { s := upgradeFixture("ready", false); s.Prior.Image = s.Candidate.Image; return s },
		"finished rollback": func() *State {
			s, _ := rollbackState(upgradeFixture("ready", false), false)
			s.Phase = "ready"
			return s
		},
		"running rollback": func() *State {
			s, _ := rollbackState(upgradeFixture("ready", false), false)
			s.Phase = "reverting"
			return s
		},
	} {
		if _, err := rollbackState(s(), true); err == nil {
			t.Fatalf("%s must be refused", name)
		}
	}
}

func TestASavedPlanCanAlwaysBeCancelled(t *testing.T) {
	s := upgradeFixture("planned", false)
	s.Prior.Image, s.PriorImage = s.Candidate.Image, s.Candidate.Image
	next, err := rollbackState(s, false)
	if err != nil {
		t.Fatalf("a same-image plan has changed nothing and must be cancellable: %v", err)
	}
	next.SchemaVersion, next.Sequence, next.UpdatedAt, next.Previous, next.Phase = Schema, 2, "2026-11-03T00:00:00Z", strings.Repeat("2", 64), "ready"
	if err = next.validate(); err != nil {
		t.Fatal(err)
	}
}

func TestRollbackDoesNotRewindReleaseReplayProtection(t *testing.T) {
	older := &release.ReleaseCheckpoint{SchemaVersion: "vaultix.release-checkpoint.v1", Sequence: 4, SHA256: strings.Repeat("a", 64)}
	newer := &release.ReleaseCheckpoint{SchemaVersion: "vaultix.release-checkpoint.v1", Sequence: 7, SHA256: strings.Repeat("b", 64)}
	s := upgradeFixture("validating", false)
	s.Candidate.Trust, s.Candidate.ExpiresAt, s.Candidate.Checkpoint = "signed-bundle", "2026-11-03T00:00:00Z", newer
	s.Prior.Trust, s.Prior.ExpiresAt, s.Prior.Checkpoint = "signed-bundle", "2026-01-01T00:00:00Z", older
	next, err := rollbackState(s, false)
	if err != nil {
		t.Fatal(err)
	}
	if next.Candidate.Checkpoint != older || next.RetainedCheckpoint != newer {
		t.Fatal("rollback must target the older release and remember the newest one verified")
	}
	if newestCheckpoint(next.RetainedCheckpoint, next.Candidate.Checkpoint) != newer {
		t.Fatal("the next upgrade would accept a replayed release")
	}
	// A plan from a local build carries no checkpoint of its own, and cancelling it
	// must not lose the one the instance remembers.
	planned := upgradeFixture("planned", false)
	planned.RetainedCheckpoint = newer
	planned.SchemaVersion, planned.Sequence, planned.UpdatedAt, planned.Previous = Schema, 2, "2026-11-03T00:00:00Z", strings.Repeat("2", 64)
	if err = planned.validate(); err != nil {
		t.Fatalf("an upgrade must be able to carry the newest verified release: %v", err)
	}
	cancelled, err := rollbackState(planned, false)
	if err != nil {
		t.Fatal(err)
	}
	if newestCheckpoint(cancelled.RetainedCheckpoint, cancelled.Candidate.Checkpoint) != newer {
		t.Fatal("cancelling a plan would accept a replayed release")
	}
	install := fixtureState()
	install.RetainedCheckpoint = newer
	install.SchemaVersion, install.Sequence, install.UpdatedAt, install.Phase = Schema, 1, "2026-11-03T00:00:00Z", "planned"
	if install.validate() == nil {
		t.Fatal("only an upgrade has an earlier release to remember")
	}
}

// advance decides by what the context reports, so the application's fate on an
// interrupt or the time limit is exercised here, up to the first Docker effect.
func TestAdvanceOnlyReturnsThePreviousApplicationOnTheRehearsalTimeLimit(t *testing.T) {
	expired := func() (context.Context, context.CancelFunc) {
		return context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	}
	interrupted := func() (context.Context, context.CancelFunc) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		return ctx, cancel
	}
	for _, tc := range []struct {
		name, phase string
		context     func() (context.Context, context.CancelFunc)
		returns     bool
	}{
		{"time limit in rehearsal", "rehearsing", expired, true},
		{"interrupt in rehearsal", "rehearsing", interrupted, false},
		{"time limit in checkpoint", "snapshot", expired, false},
		{"time limit in live migration", "migrating", expired, false},
	} {
		d, _ := fakeDocker(t, "0", "")
		if err := os.Mkdir(filepath.Join(d.root, "config"), 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"instance.json", "compose.yml", "vaultix.env", "recovery.key"} {
			if err := newFile(configPath(d.root, name), []byte(name)); err != nil {
				t.Fatal(err)
			}
		}
		s := upgradeFixture(tc.phase, true)
		fingerprint, err := configuration(d.root)
		if err != nil {
			t.Fatal(err)
		}
		s.Configuration = fingerprint
		if err = saveState(d.root, s, tc.phase); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := tc.context()
		err = advance(ctx, d, s, io.Discard)
		cancel()
		if err == nil {
			t.Fatalf("%s: the fake Docker cannot finish an operation", tc.name)
		}
		saved, loadErr := loadState(d.root)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if returned := saved.Action == "rollback" && saved.RevertedFrom == tc.phase; returned != tc.returns {
			t.Fatalf("%s: returned to the previous application=%v, state %s/%s", tc.name, returned, saved.Action, saved.Phase)
		}
		if !tc.returns && saved.Phase != tc.phase {
			t.Fatalf("%s: the operation must stay where it was for the operator, found %s", tc.name, saved.Phase)
		}
	}
}

func TestStateRulesForMigrationPhases(t *testing.T) {
	stamp := func(s *State) *State {
		s.SchemaVersion, s.Sequence, s.UpdatedAt, s.Previous = Schema, 2, "2026-11-03T00:00:00Z", strings.Repeat("2", 64)
		return s
	}
	for _, phase := range []string{"rehearsing", "migrating"} {
		if err := stamp(upgradeFixture(phase, true)).validate(); err != nil {
			t.Fatalf("%s: %v", phase, err)
		}
		if stamp(upgradeFixture(phase, false)).validate() == nil {
			t.Fatalf("%s needs a migration plan", phase)
		}
	}
	for _, phase := range []string{"reverting", "restoring"} {
		if stamp(upgradeFixture(phase, true)).validate() == nil {
			t.Fatalf("%s belongs to a rollback", phase)
		}
	}
	for name, mutate := range map[string]func(*State){
		"pending missing":      func(s *State) { s.Migration.Pending = nil },
		"unsafe pending name":  func(s *State) { s.Migration.Pending = []string{"../escape"} },
		"prior mismatch":       func(s *State) { s.PriorImage = "sha256:" + strings.Repeat("0", 64) },
		"rollback record":      func(s *State) { s.RevertedFrom = "ready" },
		"retained on upgrade":  func(s *State) { s.RetainedDatabase = "vaultix-replaced-a" },
		"short plan reference": func(s *State) { s.Migration.Secrets = "short" },
	} {
		s := stamp(upgradeFixture("replacing", true))
		mutate(s)
		if s.validate() == nil {
			t.Fatalf("%s must be invalid", name)
		}
	}
	rolled, err := rollbackState(upgradeFixture("ready", true), true)
	if err != nil {
		t.Fatal(err)
	}
	stamp(rolled).Phase = "restoring"
	rolled.Migration.Secrets = ""
	if rolled.validate() == nil {
		t.Fatal("a restore without its recorded checkpoint must be invalid")
	}
}

func TestRollbackMessageNamesWhatTheOperatorStillOwns(t *testing.T) {
	s, err := rollbackState(upgradeFixture("ready", true), true)
	if err != nil {
		t.Fatal(err)
	}
	s.RetainedDatabase = "vaultix-replaced-a"
	local := completionMessage(s)
	if !strings.Contains(local, s.RetainedDatabase) || !strings.Contains(local, "local cache was cleared") {
		t.Fatalf("restore outcome is missing: %s", local)
	}
	s.Cache = ""
	if external := completionMessage(s); !strings.Contains(external, "Clear your external cache") {
		t.Fatalf("an external cache must be left to the operator explicitly: %s", external)
	}
	images, err := rollbackState(upgradeFixture("ready", false), false)
	if err != nil {
		t.Fatal(err)
	}
	if message := completionMessage(images); strings.Contains(message, "restored") {
		t.Fatalf("an image-only rollback restored nothing: %s", message)
	}
}

// A saved operation from the earlier CLI has none of the new fields and must load.
func TestEarlierStateStillLoads(t *testing.T) {
	root := privateTemp(t)
	earlier := `{"schemaVersion":"vaultix.instance-operation.v1","sequence":1,"previous":"","operation":"op-test","action":"upgrade","phase":"validating","configuration":"` + strings.Repeat("a", 64) + `","candidate":{"image":"sha256:` + strings.Repeat("b", 64) + `","revision":"` + strings.Repeat("c", 40) + `","migrations":"` + strings.Repeat("d", 64) + `","evidence":"` + strings.Repeat("e", 64) + `","trust":"local-build"},"priorImage":"sha256:` + strings.Repeat("1", 64) + `","priorContainer":"` + strings.Repeat("9", 64) + `","database":"` + strings.Repeat("8", 64) + `","databaseImage":"sha256:` + strings.Repeat("7", 64) + `","databaseVolume":"data","updatedAt":"2026-11-02T00:00:00Z"}` + "\n"
	if err := newFile(filepath.Join(root, "event-00000001.json"), []byte(earlier)); err != nil {
		t.Fatal(err)
	}
	s, err := loadState(root)
	if err != nil || s == nil || s.Phase != "validating" {
		t.Fatalf("earlier state did not load: %v", err)
	}
	if _, err = rollbackState(s, true); err == nil {
		t.Fatal("an operation with no recorded previous candidate cannot roll back")
	}
}
