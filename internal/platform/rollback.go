package platform

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"shippin.cloud/vaultix/internal/release"
)

// The live store changes from the migrating phase onward, and the candidate can
// answer requests from replacing onward because its port is published on start.
func candidateMayHaveServed(phase string) bool {
	return phase == "replacing" || phase == "validating" || phase == "ready"
}
func liveStoreChanged(m *MigrationPlan, phase string) bool {
	return m != nil && (phase == "migrating" || candidateMayHaveServed(phase))
}

// rollbackState turns an upgrade into an operation whose target is the previous
// application, so the existing replacing and validating phases apply unchanged.
func rollbackState(s *State, discardWrites bool) (*State, error) {
	if s.Action == "rollback" {
		if s.Phase == "ready" {
			return nil, errors.New("this upgrade has already been rolled back")
		}
		return nil, errors.New("a rollback is in progress; resume it with vaultix server recover")
	}
	if s.Action != "upgrade" || s.Prior == nil {
		return nil, errors.New("this operation has no previous application to return to")
	}
	if s.Prior.Image == s.Candidate.Image {
		return nil, errors.New("this operation did not change the application image; there is nothing to roll back")
	}
	if liveStoreChanged(s.Migration, s.Phase) && candidateMayHaveServed(s.Phase) && !discardWrites {
		return nil, errors.New("the new application may have accepted writes, and rollback restores the database to the checkpoint taken before the upgrade; repeat with --discard-writes to accept that")
	}
	next := *s
	reverted := s.Candidate
	next.Action = "rollback"
	next.Candidate = *s.Prior
	next.Prior = nil
	next.Reverted = &reverted
	next.RevertedFrom = s.Phase
	// Going back to an older release does not rewind what this instance has already
	// verified, so the next bundle is still checked against the newest one.
	next.RetainedCheckpoint = newestCheckpoint(s.RetainedCheckpoint, s.Candidate.Checkpoint)
	return &next, nil
}

func newestCheckpoint(a, b *release.ReleaseCheckpoint) *release.ReleaseCheckpoint {
	if a == nil || b != nil && b.Sequence > a.Sequence {
		return b
	}
	return a
}

// rollbackPreflight refuses what would block a rollback once it is saved. Saving
// commits to it and the next step stops an application, so this is the last point
// where the operator can walk away with everything as it is.
func (d *Docker) rollbackPreflight(ctx context.Context, next *State, discardWrites bool) error {
	if err := d.image(ctx, next.Candidate.Image, next.Candidate.Revision); err != nil {
		return errors.New("the previous application image is no longer available on this host")
	}
	if fp, err := configuration(d.root); err != nil || fp != next.Configuration {
		return errors.New("configuration changed since this operation; restore the reviewed bytes before rolling back")
	}
	if next.RevertedFrom == "planned" {
		return nil
	}
	if err := d.preserved(ctx, next); err != nil {
		return err
	}
	current, err := d.service(ctx, "backend")
	if err != nil {
		return err
	}
	if current != nil && current.Image != next.Candidate.Image && current.Image != next.Reverted.Image {
		return errors.New("running image changed outside this operation owner")
	}
	if !liveStoreChanged(next.Migration, next.RevertedFrom) {
		return nil
	}
	if err = checkBackup(d.root, next); err != nil {
		return err
	}
	if _, err = privateRead(configPath(d.root, "recovery.key"), 8192); err != nil {
		return errors.New("recovery key is unavailable")
	}
	// Before the candidate starts nothing should be running, so whatever is was started
	// by hand, and its writes are about to leave the live store.
	if current != nil && current.State.Running && !discardWrites {
		return errors.New("an application is running against this database, and rollback restores it from the checkpoint; repeat with --discard-writes to accept losing its writes")
	}
	return nil
}

// discardRehearsal runs even when the operation's context has ended, because the
// container holds real settings and its output explains what happened.
func (d *Docker) discardRehearsal(s *State) {
	cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if c, err := d.inspect(cleanup, "vaultix-rehearsal-"+s.Operation); err == nil {
		d.migrationLog(cleanup, s, "rehearsal", c.ID)
		_, _ = d.run(cleanup, "rm", "-f", "-v", c.ID)
	}
}

func (d *Docker) revert(ctx context.Context, s *State) error {
	// An interrupted attempt can leave a copy of the store and a container holding
	// real settings, and an abandoned migration must not keep writing to this store.
	for _, role := range []string{"restore", "rehearsal", "migrate"} {
		c, err := d.inspect(ctx, "vaultix-"+role+"-"+s.Operation)
		if err != nil {
			continue
		}
		if c.Config.Labels["vaultix.lifecycle.operation"] != s.Operation {
			return errors.New("operation container name belongs to another resource")
		}
		if role != "restore" {
			d.migrationLog(ctx, s, role, c.ID)
		}
		if _, err = d.run(ctx, "rm", "-f", "-v", c.ID); err != nil {
			return err
		}
	}
	current, err := d.service(ctx, "backend")
	if err != nil {
		return err
	}
	// A running previous application stays up unless its store is about to be replaced.
	if current == nil || current.Image == s.Candidate.Image && !liveStoreChanged(s.Migration, s.RevertedFrom) {
		return nil
	}
	if current.Image != s.Candidate.Image && current.Image != s.Reverted.Image {
		return errors.New("running image changed outside this operation owner")
	}
	// A failed candidate may be crash-looping, so a clean exit is not required here.
	if _, err = d.run(ctx, "stop", "--signal", "SIGTERM", "--timeout", "90", current.ID); err != nil {
		return err
	}
	stopped, err := d.inspect(ctx, current.ID)
	if err != nil {
		return err
	}
	if stopped.State.Running {
		return errors.New("the failed application did not stop")
	}
	return nil
}

func restoredDatabaseNames(operation string) (string, string) {
	suffix := strings.TrimPrefix(operation, "op-")
	if len(suffix) > 12 {
		suffix = suffix[:12]
	}
	return "vaultix-restore-" + suffix, "vaultix-replaced-" + suffix
}

func (d *Docker) checkRestored(ctx context.Context, s *State, user, db string) error {
	applied, err := d.appliedMigrations(ctx, s.Database, user, db)
	if err != nil {
		return err
	}
	secrets, err := d.secretsFingerprint(ctx, s.Database, user, db)
	if err != nil {
		return err
	}
	if appliedDigest(applied) != s.Migration.Applied || secrets != s.Migration.Secrets {
		return errors.New("restored database does not match the recovery checkpoint")
	}
	return nil
}

// restoreStore never overwrites the live database. It restores beside it, proves
// the copy, then swaps both names in one transaction, so a failure at any step
// leaves a usable store and the replaced database stays for investigation.
func (d *Docker) restoreStore(ctx context.Context, s *State) error {
	if err := checkBackup(d.root, s); err != nil {
		return err
	}
	key, err := privateRead(configPath(d.root, "recovery.key"), 8192)
	if err != nil {
		return errors.New("recovery key is unavailable")
	}
	user, db, err := d.dbNames(ctx, s.Database)
	if err != nil {
		return err
	}
	restored, replaced := restoredDatabaseNames(s.Operation)
	// template1 always exists and is never one of the databases being renamed.
	maintenance := func(query string) ([]byte, error) { return d.psql(ctx, s.Database, user, "template1", query) }
	swapped, err := maintenance(fmt.Sprintf("SELECT count(*) FROM pg_database WHERE datname='%s';", replaced))
	if err != nil {
		return err
	}
	if !bytes.Equal(swapped, []byte("1")) {
		for _, query := range []string{
			fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE);`, restored),
			fmt.Sprintf(`CREATE DATABASE %q TEMPLATE template0;`, restored),
		} {
			if _, err = maintenance(query); err != nil {
				return err
			}
		}
		if err = d.restoreArchive(ctx, s, key, s.Database, user, restored); err != nil {
			return err
		}
		if err = d.checkRestored(ctx, s, user, restored); err != nil {
			return err
		}
		if _, err = maintenance(fmt.Sprintf(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname IN ('%s','%s') AND pid <> pg_backend_pid();`, db, restored)); err != nil {
			return err
		}
		if _, err = maintenance(fmt.Sprintf(`BEGIN; ALTER DATABASE %q RENAME TO %q; ALTER DATABASE %q RENAME TO %q; COMMIT;`, db, replaced, restored, db)); err != nil {
			return err
		}
	}
	if err = d.checkRestored(ctx, s, user, db); err != nil {
		return err
	}
	s.RetainedDatabase = replaced
	// Entries the failed application cached can describe writes that are no longer
	// in the store. An external cache is not this tool's to clear; see the result.
	if candidateMayHaveServed(s.RevertedFrom) && s.Cache != "" {
		if _, err = d.run(ctx, "exec", s.Cache, "redis-cli", "FLUSHALL"); err != nil {
			return err
		}
	}
	return nil
}

func completionMessage(s *State) string {
	if s.Action != "rollback" {
		return "Vaultix is running. First installation continues with owner setup in the application. Back up the private instance directory and recovery key to separate storage."
	}
	message := "Vaultix is running the previous application."
	if liveStoreChanged(s.Migration, s.RevertedFrom) {
		message += fmt.Sprintf(" The database was restored from the checkpoint taken before the upgrade. The database it replaced is kept as %s; remove it when you no longer need it.", s.RetainedDatabase)
		if candidateMayHaveServed(s.RevertedFrom) {
			if s.Cache == "" {
				message += " Clear your external cache now: it can still hold entries from the rolled-back application."
			} else {
				message += " The local cache was cleared, so queued background jobs were discarded."
			}
		}
	}
	return message
}
