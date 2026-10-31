package auditlog

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/vaultix/api/internal/ee/services/license"
	"github.com/vaultix/api/internal/queue"
	"github.com/vaultix/api/internal/services/project"
)

const auditLogStreamKey = "audit-log-stream"

type projectService interface {
	GetByID(ctx context.Context, projectID string) (*project.Project, error)
}

type licenseService interface {
	GetPlan(ctx context.Context, orgID string) (*license.FeatureSet, error)
}

type auditStream interface {
	StreamAdd(ctx context.Context, stream, id string, values map[string]string) (string, error)
}

// QueueHandlerDeps holds dependencies for the audit log queue handler.
type QueueHandlerDeps struct {
	Project  projectService
	License  licenseService
	KeyStore auditStream
}

// QueueHandler resolves the native event and delivers the same ingest envelope
// used by the application. The shared consumer owns storage and stream fanout.
type QueueHandler struct {
	logger   *slog.Logger
	project  projectService
	license  licenseService
	keyStore auditStream
}

func NewQueueHandler(_ context.Context, logger *slog.Logger, deps *QueueHandlerDeps) *QueueHandler {
	return &QueueHandler{
		logger:  logger.With(slog.String("queue_handler", "auditlog")),
		project: deps.Project, license: deps.License, keyStore: deps.KeyStore,
	}
}

func (h *QueueHandler) Register(queueSvc *queue.Service) {
	queue.RegisterHandler(queueSvc, TaskAuditLog, h.HandleAuditLog)
}

// HandleAuditLog returns delivery failures to the job runner for retry. Enqueue
// and stream acknowledgement are not an atomic record of the source operation.
func (h *QueueHandler) HandleAuditLog(ctx context.Context, task *queuedAuditLog) error {
	if task == nil || task.Event.Metadata == nil {
		return fmt.Errorf("missing audit event")
	}
	orgID := task.OrgID
	var projectName string
	if orgID == nil && task.ProjectID != nil {
		proj, err := h.project.GetByID(ctx, *task.ProjectID)
		if err != nil {
			return fmt.Errorf("finding audit project: %w", err)
		}
		if proj != nil {
			orgID = &proj.OrgID
			projectName = proj.Name
		}
	}
	if orgID == nil || *orgID == uuid.Nil {
		return fmt.Errorf("missing audit organization")
	}
	plan, err := h.license.GetPlan(ctx, orgID.String())
	if err != nil {
		return fmt.Errorf("getting audit retention: %w", err)
	}
	if plan == nil {
		return fmt.Errorf("missing audit retention policy")
	}
	if plan.AuditLogsRetentionDays == 0 {
		return nil
	}

	id, createdAt := task.ID, task.CreatedAt
	if id == uuid.Nil && createdAt.IsZero() {
		// Jobs from older binaries did not pin identity. Keep them deliverable;
		// their worker retries retain the old at-least-once duplicate risk.
		id, err = uuid.NewV7()
		if err != nil {
			return fmt.Errorf("generating legacy audit ID: %w", err)
		}
		createdAt = time.Now().UTC().Truncate(time.Millisecond)
		h.logger.WarnContext(ctx, "processing legacy audit job without producer identity")
	} else if id == uuid.Nil || createdAt.IsZero() {
		return fmt.Errorf("incomplete audit delivery identity")
	}

	// Nested actor/event is the ingest protocol, not the flattened storage row.
	// Both PostgreSQL and ClickHouse use this path so native events participate
	// in configured external-stream fanout and the consumer's storage switches.
	entry := struct {
		CreateAuditLogDTO
		ID          uuid.UUID `json:"id"`
		CreatedAt   time.Time `json:"createdAt"`
		ExpiresAt   time.Time `json:"expiresAt"`
		ProjectName string    `json:"projectName,omitempty"`
	}{
		CreateAuditLogDTO: task.CreateAuditLogDTO, ID: id, CreatedAt: createdAt,
		ExpiresAt:   createdAt.Add(time.Duration(plan.AuditLogsRetentionDays) * 24 * time.Hour),
		ProjectName: projectName,
	}
	entry.OrgID = orgID
	payload, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("marshaling audit ingest entry: %w", err)
	}
	if h.keyStore == nil {
		return fmt.Errorf("audit ingest stream unavailable")
	}
	if _, err := h.keyStore.StreamAdd(ctx, auditLogStreamKey, "*", map[string]string{"data": string(payload)}); err != nil {
		return fmt.Errorf("appending audit ingest entry: %w", err)
	}
	return nil
}
