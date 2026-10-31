//go:build integration

package auditlog

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/config"
	"github.com/vaultix/api/internal/queue"
)

// The boundary runner supplies a disposable cache. Never use an operator cache:
// this test expects an empty queue and does not flush or delete existing data.
func TestAuditLog_ProducerPinsQueueIdentity(t *testing.T) {
	addr := os.Getenv("VAULTIX_AUDIT_TEST_CACHE")
	require.NotEmpty(t, addr, "disposable audit-test cache required")
	client := redis.NewClient(&redis.Options{Addr: addr})
	t.Cleanup(func() { _ = client.Close() })
	require.NoError(t, client.Ping(t.Context()).Err())
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	q := queue.NewService(t.Context(), logger, client)
	t.Cleanup(func() { _ = q.Close() })
	svc := NewService(t.Context(), logger, &Deps{Queue: q, Config: &config.Config{}})
	inspector := asynq.NewInspectorFromRedisClient(client)
	before := time.Now().UTC().Truncate(time.Millisecond)
	dto := auditFixture().CreateAuditLogDTO
	require.NoError(t, svc.CreateAuditLog(t.Context(), &dto))
	require.NoError(t, svc.CreateAuditLog(t.Context(), &dto))
	jobs, err := inspector.ListPendingTasks("default")
	require.NoError(t, err)
	require.Len(t, jobs, 2)
	seen := map[uuid.UUID]bool{}
	for _, job := range jobs {
		require.Equal(t, TaskAuditLog.Name(), job.Type)
		var payload queuedAuditLog
		require.NoError(t, json.Unmarshal(job.Payload, &payload))
		require.NotEqual(t, uuid.Nil, payload.ID)
		require.False(t, seen[payload.ID])
		seen[payload.ID] = true
		require.False(t, payload.CreatedAt.Before(before))
		require.False(t, payload.CreatedAt.After(time.Now().UTC()))
		// Exercise the job emitted by the real producer through two independent
		// deliveries. The separate retry test also injects an acknowledgement failure.
		store := &capturedStream{}
		require.NoError(t, auditHandler(store).HandleAuditLog(t.Context(), &payload))
		var retry queuedAuditLog
		require.NoError(t, json.Unmarshal(job.Payload, &retry))
		require.NoError(t, auditHandler(store).HandleAuditLog(t.Context(), &retry))
		require.Equal(t, store.entries[0], store.entries[1])
		var legacy CreateAuditLogDTO
		require.NoError(t, json.Unmarshal(job.Payload, &legacy))
		require.Equal(t, dto.OrgID, legacy.OrgID)
		require.Equal(t, dto.Event.Type(), legacy.Event.Type())
	}
	svc.config.DisableAuditLogGeneration = true
	require.NoError(t, svc.CreateAuditLog(t.Context(), &dto))
	jobs, err = inspector.ListPendingTasks("default")
	require.NoError(t, err)
	require.Len(t, jobs, 2)
	svc.config.DisableAuditLogGeneration = false
	require.Error(t, svc.CreateAuditLog(t.Context(), nil))
	require.NoError(t, client.Close())
	require.Error(t, svc.CreateAuditLog(t.Context(), &dto), "queue failure must reach caller")
}
