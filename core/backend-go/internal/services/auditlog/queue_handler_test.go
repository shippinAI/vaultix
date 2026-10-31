package auditlog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/ee/services/license"
	"github.com/vaultix/api/internal/services/project"
)

type capturedStream struct {
	entries []string
	err     error
}

func (s *capturedStream) StreamAdd(_ context.Context, stream, id string, fields map[string]string) (string, error) {
	if stream != "audit-log-stream" || id != "*" || len(fields) != 1 {
		return "", errors.New("unexpected ingest protocol")
	}
	s.entries = append(s.entries, fields["data"])
	return "1-0", s.err
}

type auditPlan struct {
	plan *license.FeatureSet
	err  error
}

func (p auditPlan) GetPlan(context.Context, string) (*license.FeatureSet, error) {
	return p.plan, p.err
}

type auditProject struct {
	project *project.Project
	err     error
}

func (p auditProject) GetByID(context.Context, string) (*project.Project, error) {
	return p.project, p.err
}

func auditFixture() *queuedAuditLog {
	return &queuedAuditLog{
		CreateAuditLogDTO: CreateAuditLogDTO{
			OrgID: new(uuid.MustParse("33333333-3333-4333-8333-333333333333")),
			Actor: Actor{Type: ActorTypeUser, Metadata: UserActorMetadata{
				UserID: "11111111-1111-4111-8111-111111111111", Username: "public-fixture", AuthMethod: "email",
			}},
			Event: Event{Metadata: GetSecretsEventMetadata{Environment: "dev", SecretPath: "/", NumberOfSecrets: 0}},
		},
		ID: uuid.MustParse("019a3b00-0000-7000-8000-000000000001"), CreatedAt: time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC),
	}
}

func auditHandler(store *capturedStream) *QueueHandler {
	return NewQueueHandler(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &QueueHandlerDeps{
		Project: nil, License: auditPlan{plan: &license.FeatureSet{AuditLogsRetentionDays: 30}}, KeyStore: store,
	})
}

func TestAuditLog_IngestEnvelope(t *testing.T) {
	store := &capturedStream{}
	task := auditFixture()
	require.NoError(t, auditHandler(store).HandleAuditLog(t.Context(), task))
	require.Len(t, store.entries, 1)
	var entry map[string]any
	require.NoError(t, json.Unmarshal([]byte(store.entries[0]), &entry))
	require.Equal(t, task.ID.String(), entry["id"])
	require.Equal(t, "2026-10-31T00:00:00Z", entry["createdAt"])
	require.Equal(t, "2026-11-30T00:00:00Z", entry["expiresAt"])
	require.Equal(t, "user", entry["actor"].(map[string]any)["type"])
	require.Equal(t, "get-secrets", entry["event"].(map[string]any)["type"])
	require.NotContains(t, entry, "eventType")
	// Public fixture only. The cross-language runner feeds this exact producer
	// output into the real TypeScript consumer, with independent assertions.
	fmt.Println("VAULTIX_AUDIT_FIXTURE:" + store.entries[0])
}

func TestAuditLog_RetryPreservesIdentity(t *testing.T) {
	store := &capturedStream{err: errors.New("acknowledgement lost")}
	h := auditHandler(store)
	task := auditFixture()
	wire, err := json.Marshal(task)
	require.NoError(t, err)
	var initial queuedAuditLog
	require.NoError(t, json.Unmarshal(wire, &initial))
	require.Error(t, h.HandleAuditLog(t.Context(), &initial))
	// A different worker deserializes the original job, not a mutated in-memory object.
	var retry queuedAuditLog
	require.NoError(t, json.Unmarshal(wire, &retry))
	store.err = nil
	require.NoError(t, auditHandler(store).HandleAuditLog(t.Context(), &retry))
	require.Len(t, store.entries, 2)
	require.Equal(t, store.entries[0], store.entries[1])
}

func TestAuditLog_LegacyJobAndProject(t *testing.T) {
	task := auditFixture()
	task.OrgID = nil
	task.ProjectID = new("22222222-2222-4222-8222-222222222222")
	wire, err := json.Marshal(task.CreateAuditLogDTO)
	require.NoError(t, err)
	var legacy queuedAuditLog
	require.NoError(t, json.Unmarshal(wire, &legacy))
	store := &capturedStream{}
	h := auditHandler(store)
	h.project = auditProject{project: &project.Project{OrgID: *auditFixture().OrgID, Name: "Fixture project"}}
	require.NoError(t, h.HandleAuditLog(t.Context(), &legacy))
	var entry map[string]any
	require.NoError(t, json.Unmarshal([]byte(store.entries[0]), &entry))
	require.Equal(t, auditFixture().OrgID.String(), entry["orgId"])
	require.Equal(t, "Fixture project", entry["projectName"])
	require.NotEmpty(t, entry["id"])
	require.Nil(t, legacy.OrgID, "must not mutate original queued payload")
}

func TestAuditLog_FailuresAndRetention(t *testing.T) {
	for _, name := range []string{"missing-event", "missing-org", "missing-policy", "policy-error", "missing-stream", "incomplete-id", "incomplete-time", "metadata-error", "project-error"} {
		t.Run(name, func(t *testing.T) {
			store := &capturedStream{}
			h, task := auditHandler(store), auditFixture()
			switch name {
			case "missing-event":
				task.Event.Metadata = nil
			case "missing-org":
				task.OrgID = nil
			case "missing-policy":
				h.license = auditPlan{}
			case "policy-error":
				h.license = auditPlan{err: errors.New("unavailable")}
			case "missing-stream":
				h.keyStore = nil
			case "incomplete-id":
				task.ID = uuid.Nil
			case "incomplete-time":
				task.CreatedAt = time.Time{}
			case "metadata-error":
				task.Actor.Metadata = func() {}
			case "project-error":
				task.OrgID, task.ProjectID = nil, new("project")
				h.project = auditProject{err: errors.New("unavailable")}
			}
			require.Error(t, h.HandleAuditLog(t.Context(), task))
			require.Empty(t, store.entries)
		})
	}
	store := &capturedStream{}
	h := auditHandler(store)
	h.license = auditPlan{plan: &license.FeatureSet{AuditLogsRetentionDays: 0}}
	require.NoError(t, h.HandleAuditLog(t.Context(), auditFixture()))
	require.Empty(t, store.entries)
}
