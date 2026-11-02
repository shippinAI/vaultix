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

type Candidate struct {
	Image      string                     `json:"image"`
	Revision   string                     `json:"revision"`
	Migrations string                     `json:"migrations"`
	Evidence   string                     `json:"evidence"`
	Trust      string                     `json:"trust"`
	ExpiresAt  string                     `json:"expiresAt,omitempty"`
	Checkpoint *release.ReleaseCheckpoint `json:"checkpoint,omitempty"`
}

type Instance struct {
	SchemaVersion string `json:"schemaVersion"`
	ID            string `json:"id"`
	Project       string `json:"project"`
	SiteURL       string `json:"siteUrl"`
	Port          int    `json:"port"`
	Daemon        string `json:"daemon"`
}

func (i Instance) validate() error {
	u, err := url.Parse(i.SiteURL)
	if err != nil || i.SchemaVersion != Schema || !namePattern.MatchString(i.ID) || !namePattern.MatchString(i.Project) || i.Port < 1 || i.Port > 65535 || i.Daemon == "" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
		return errors.New("invalid instance identity")
	}
	return nil
}

// An immutable snapshot is published before each externally visible effect.
// Recovery repeats that effect only after reconciling the named Docker resources.
type State struct {
	SchemaVersion   string    `json:"schemaVersion"`
	Sequence        int       `json:"sequence"`
	Previous        string    `json:"previous"`
	Operation       string    `json:"operation"`
	Action          string    `json:"action"`
	Phase           string    `json:"phase"`
	Configuration   string    `json:"configuration"`
	Candidate       Candidate `json:"candidate"`
	PriorImage      string    `json:"priorImage,omitempty"`
	PriorContainer  string    `json:"priorContainer,omitempty"`
	Database        string    `json:"database,omitempty"`
	DatabaseImage   string    `json:"databaseImage,omitempty"`
	DatabaseVolume  string    `json:"databaseVolume,omitempty"`
	Cache           string    `json:"cache,omitempty"`
	Backup          string    `json:"backup,omitempty"`
	BackupHash      string    `json:"backupHash,omitempty"`
	EnvironmentHash string    `json:"environmentHash,omitempty"`
	UpdatedAt       string    `json:"updatedAt"`
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

func (s State) validate() error {
	if s.SchemaVersion != Schema || s.Sequence < 1 || !namePattern.MatchString(s.Operation) ||
		(s.Action != "install" && s.Action != "upgrade" && s.Action != "adopt") || !hashPattern.MatchString(s.Configuration) ||
		!imagePattern.MatchString(s.Candidate.Image) || !revisionPattern.MatchString(s.Candidate.Revision) ||
		!hashPattern.MatchString(s.Candidate.Migrations) || !hashPattern.MatchString(s.Candidate.Evidence) {
		return errors.New("invalid lifecycle state")
	}
	switch s.Phase {
	case "planned", "dependencies", "stopping", "snapshot", "replacing", "validating", "ready":
	default:
		return errors.New("unknown lifecycle phase")
	}
	if s.Candidate.Trust != "local-build" && s.Candidate.Trust != "signed-bundle" && !(s.Action == "adopt" && s.Candidate.Trust == "existing-instance") {
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
	if s.Action != "install" && (!imagePattern.MatchString(s.PriorImage) || !hashPattern.MatchString(s.PriorContainer)) {
		return errors.New("missing previous application identity")
	}
	if s.Phase != "planned" && s.Phase != "dependencies" || s.Action != "install" {
		if !hashPattern.MatchString(s.Database) || !imagePattern.MatchString(s.DatabaseImage) || s.DatabaseVolume == "" || s.Cache != "" && !hashPattern.MatchString(s.Cache) {
			return errors.New("missing dependency identity")
		}
	}
	if s.Candidate.Trust == "signed-bundle" {
		if _, err := time.Parse(time.RFC3339, s.Candidate.ExpiresAt); err != nil || s.Candidate.Checkpoint == nil {
			return errors.New("missing signed release checkpoint")
		}
	} else if s.Candidate.ExpiresAt != "" || s.Candidate.Checkpoint != nil {
		return errors.New("unexpected release trust metadata")
	}
	return nil
}
