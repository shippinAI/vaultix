package auditlog

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/vaultix/api/internal/config"
	"github.com/vaultix/api/internal/libs/errutil"
	"github.com/vaultix/api/internal/queue"
)

// Deps holds dependencies for the audit log service.
type Deps struct {
	Queue  *queue.Service
	Config *config.Config
}

// Service provides audit log functionality.
type Service struct {
	logger *slog.Logger
	queue  *queue.Service
	config *config.Config
}

// NewService creates a new audit log service.
func NewService(_ context.Context, logger *slog.Logger, deps *Deps) *Service {
	return &Service{
		logger: logger.With(slog.String("service", "auditlog")),
		queue:  deps.Queue,
		config: deps.Config,
	}
}

// CreateAuditLog validates and queues an audit log entry for async processing.
func (s *Service) CreateAuditLog(ctx context.Context, dto *CreateAuditLogDTO) error {
	if s.config.DisableAuditLogGeneration {
		return nil
	}
	if dto == nil || dto.Event.Metadata == nil {
		return errutil.BadRequest("Audit event is required")
	}

	if dto.ProjectID == nil && dto.OrgID == nil {
		return errutil.BadRequest("Must specify either projectId or orgId").WithErrf("CreateAuditLog: both projectId and orgId are nil")
	}

	id, err := uuid.NewV7()
	if err != nil {
		return errutil.InternalServer("Failed to create audit log").WithErrf("CreateAuditLog: generate event ID: %w", err)
	}
	task := &queuedAuditLog{CreateAuditLogDTO: *dto, ID: id, CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
	if err := queue.Enqueue(ctx, s.queue, TaskAuditLog, task, queue.WithMaxRetry(3)); err != nil {
		s.logger.ErrorContext(ctx, "failed to enqueue audit log",
			slog.String("eventType", string(dto.Event.Type())),
			slog.Any("error", err),
		)
		return errutil.InternalServer("Failed to create audit log").WithErrf("CreateAuditLog(eventType=%s): %w", dto.Event.Type(), err)
	}

	return nil
}
