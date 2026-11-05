// Package platform owns local instance lifecycle. Drivers execute bounded effects;
// they do not decide which image, configuration or recovery transition is allowed.
package platform

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"

	"shippin.cloud/vaultix/internal/release"
)

const Schema = "vaultix.instance-operation.v1"

var imagePattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var revisionPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
var namePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var migrationNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$`)

type Candidate struct {
	Image      string                     `json:"image"`
	Revision   string                     `json:"revision"`
	Migrations string                     `json:"migrations"`
	Evidence   string                     `json:"evidence"`
	Trust      string                     `json:"trust"`
	ExpiresAt  string                     `json:"expiresAt,omitempty"`
	Checkpoint *release.ReleaseCheckpoint `json:"checkpoint,omitempty"`
}

// MigrationPlan is the schema change an upgrade applies, bound to the store it
// was planned against. Secrets is recorded at the recovery checkpoint.
type MigrationPlan struct {
	From    string   `json:"from"`
	Applied string   `json:"applied"`
	Pending []string `json:"pending"`
	Secrets string   `json:"secrets,omitempty"`
}

type Instance struct {
	SchemaVersion string         `json:"schemaVersion"`
	ID            string         `json:"id"`
	Project       string         `json:"project"`
	SiteURL       string         `json:"siteUrl"`
	Port          int            `json:"port"`
	Daemon        string         `json:"daemon"`
	ProxyBindings []ProxyBinding `json:"proxyBindings,omitempty"`
}

func (i Instance) validate() error {
	if i.SchemaVersion == InstanceSchema && len(i.ProxyBindings) == 0 {
		return errors.New("extended instance requires explicit proxy bindings")
	}
	u, err := url.Parse(i.SiteURL)
	if err != nil || (i.SchemaVersion != Schema && i.SchemaVersion != InstanceSchema) || (i.SchemaVersion == Schema && len(i.ProxyBindings) != 0) || !namePattern.MatchString(i.ID) || !namePattern.MatchString(i.Project) || i.Port < 1 || i.Port > 65535 || i.Daemon == "" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
		return errors.New("invalid instance identity")
	}
	return validateProxyBindings(i.ProxyBindings, i.Port)
}

// An immutable snapshot is published before each externally visible effect.
// Recovery repeats that effect only after reconciling the named Docker resources.
type State struct {
	SchemaVersion      string                     `json:"schemaVersion"`
	Sequence           int                        `json:"sequence"`
	Previous           string                     `json:"previous"`
	Operation          string                     `json:"operation"`
	Action             string                     `json:"action"`
	Phase              string                     `json:"phase"`
	Configuration      string                     `json:"configuration"`
	Candidate          Candidate                  `json:"candidate"`
	PriorImage         string                     `json:"priorImage,omitempty"`
	PriorContainer     string                     `json:"priorContainer,omitempty"`
	Database           string                     `json:"database,omitempty"`
	DatabaseImage      string                     `json:"databaseImage,omitempty"`
	DatabaseVolume     string                     `json:"databaseVolume,omitempty"`
	Cache              string                     `json:"cache,omitempty"`
	Backup             string                     `json:"backup,omitempty"`
	BackupHash         string                     `json:"backupHash,omitempty"`
	EnvironmentHash    string                     `json:"environmentHash,omitempty"`
	Migration          *MigrationPlan             `json:"migration,omitempty"`
	Prior              *Candidate                 `json:"prior,omitempty"`
	Reverted           *Candidate                 `json:"reverted,omitempty"`
	RevertedFrom       string                     `json:"revertedFrom,omitempty"`
	RetainedCheckpoint *release.ReleaseCheckpoint `json:"retainedCheckpoint,omitempty"`
	RetainedDatabase   string                     `json:"retainedDatabase,omitempty"`
	UpdatedAt          string                     `json:"updatedAt"`
}

func decode(raw []byte, target any) error {
	if len(raw) == 0 || len(raw) > 1024*1024 {
		return errors.New("invalid lifecycle record size")
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil {
		return errors.New("invalid lifecycle record")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing lifecycle record")
	}
	return nil
}

func (c Candidate) validate() error {
	if !imagePattern.MatchString(c.Image) || !revisionPattern.MatchString(c.Revision) ||
		!hashPattern.MatchString(c.Migrations) || !hashPattern.MatchString(c.Evidence) {
		return errors.New("invalid lifecycle state")
	}
	if c.Trust != "local-build" && c.Trust != "signed-bundle" && c.Trust != "existing-instance" {
		return errors.New("unknown artifact trust")
	}
	if c.Trust == "signed-bundle" {
		if _, err := time.Parse(time.RFC3339, c.ExpiresAt); err != nil || c.Checkpoint == nil {
			return errors.New("missing signed release checkpoint")
		}
	} else if c.ExpiresAt != "" || c.Checkpoint != nil {
		return errors.New("unexpected release trust metadata")
	}
	return nil
}

func (m MigrationPlan) validate() error {
	if !hashPattern.MatchString(m.From) || !hashPattern.MatchString(m.Applied) || len(m.Pending) == 0 || len(m.Pending) > 10000 || m.Secrets != "" && !hashPattern.MatchString(m.Secrets) {
		return errors.New("invalid migration plan")
	}
	for _, name := range m.Pending {
		if !migrationNamePattern.MatchString(name) {
			return errors.New("invalid migration plan")
		}
	}
	return nil
}

func (s State) validate() error {
	if s.SchemaVersion != Schema || s.Sequence < 1 || !namePattern.MatchString(s.Operation) ||
		(s.Action != "install" && s.Action != "upgrade" && s.Action != "adopt" && s.Action != "rollback") || !hashPattern.MatchString(s.Configuration) {
		return errors.New("invalid lifecycle state")
	}
	switch s.Phase {
	case "planned", "dependencies", "stopping", "snapshot", "rehearsing", "migrating", "reverting", "restoring", "replacing", "validating", "ready":
	default:
		return errors.New("unknown lifecycle phase")
	}
	if err := s.Candidate.validate(); err != nil {
		return err
	}
	if s.Candidate.Trust == "existing-instance" && s.Action != "adopt" && s.Action != "rollback" {
		return errors.New("unknown artifact trust")
	}
	if _, err := time.Parse(time.RFC3339, s.UpdatedAt); err != nil {
		return errors.New("invalid operation timestamp")
	}
	if s.Sequence > 10000 || (s.Sequence == 1 && s.Previous != "") || (s.Sequence > 1 && !hashPattern.MatchString(s.Previous)) {
		return errors.New("invalid operation chain")
	}
	if s.Action == "adopt" && s.Phase != "ready" || s.Action == "install" && (s.Phase == "stopping" || s.Phase == "snapshot") || s.Action == "upgrade" && s.Phase == "dependencies" {
		return errors.New("phase does not belong to this operation")
	}
	if err := s.validateTransition(); err != nil {
		return err
	}
	if s.Action != "install" && (!imagePattern.MatchString(s.PriorImage) || !hashPattern.MatchString(s.PriorContainer)) {
		return errors.New("missing previous application identity")
	}
	if s.Phase != "planned" && s.Phase != "dependencies" || s.Action != "install" {
		if !hashPattern.MatchString(s.Database) || !imagePattern.MatchString(s.DatabaseImage) || s.DatabaseVolume == "" || s.Cache != "" && !hashPattern.MatchString(s.Cache) {
			return errors.New("missing dependency identity")
		}
	}
	return nil
}

func (s State) validateTransition() error {
	if s.Migration != nil {
		if s.Action != "upgrade" && s.Action != "rollback" {
			return errors.New("phase does not belong to this operation")
		}
		if err := s.Migration.validate(); err != nil {
			return err
		}
	}
	if s.Prior != nil {
		if s.Action != "upgrade" || s.Prior.Image != s.PriorImage {
			return errors.New("previous candidate does not match this operation")
		}
		if err := s.Prior.validate(); err != nil {
			return err
		}
	}
	switch s.Phase {
	case "rehearsing", "migrating":
		if s.Action != "upgrade" || s.Migration == nil {
			return errors.New("phase does not belong to this operation")
		}
	case "reverting", "restoring":
		if s.Action != "rollback" {
			return errors.New("phase does not belong to this operation")
		}
	}
	if s.Action != "rollback" {
		if s.Reverted != nil || s.RevertedFrom != "" || s.RetainedDatabase != "" || s.RetainedCheckpoint != nil && s.Action != "upgrade" {
			return errors.New("rollback record does not belong to this operation")
		}
		return nil
	}
	switch s.Phase {
	case "reverting", "restoring", "replacing", "validating", "ready":
	default:
		return errors.New("phase does not belong to this operation")
	}
	if s.Reverted == nil {
		return errors.New("missing rolled back candidate")
	}
	if err := s.Reverted.validate(); err != nil {
		return err
	}
	switch s.RevertedFrom {
	case "planned", "stopping", "snapshot", "rehearsing", "migrating", "replacing", "validating", "ready":
	default:
		return errors.New("unknown rollback origin")
	}
	if liveStoreChanged(s.Migration, s.RevertedFrom) && (s.Migration.Secrets == "" || s.Backup == "") {
		return errors.New("a restore needs its recovery checkpoint")
	}
	if s.RetainedDatabase != "" && !namePattern.MatchString(s.RetainedDatabase) {
		return errors.New("invalid retained database name")
	}
	return nil
}
