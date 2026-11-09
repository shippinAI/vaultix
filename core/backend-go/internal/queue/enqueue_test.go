package queue

import (
	"context"
	"errors"
	"testing"
)

func TestEnqueueReturnsBeforeDeliveryWhenContextIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := Enqueue(ctx, &Service{}, NewTask[struct{}]("audit:log"), struct{}{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled enqueue: %v", err)
	}
}
