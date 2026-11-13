package ratelimit

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestNewService_DisabledWhenNotEnabled(t *testing.T) {
	t.Parallel()

	svc := NewService(context.Background(), testLogger(), &Deps{
		Redis:      nil,
		IsEnabled:  false,
	})

	assert.False(t, svc.enabled)
	assert.Nil(t, svc.counter)
	assert.Nil(t, svc.limiter)
}

func TestService_Middleware_ReturnsNoopWhenDisabled(t *testing.T) {
	t.Parallel()

	svc := NewService(context.Background(), testLogger(), &Deps{
		IsEnabled: false,
	})

	handlerCalled := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	middleware := svc.Middleware(PresetSecrets)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/test", http.NoBody)
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	assert.True(t, handlerCalled)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestService_GlobalMiddleware_ReturnsNoopWhenDisabled(t *testing.T) {
	t.Parallel()

	svc := NewService(context.Background(), testLogger(), &Deps{
		IsEnabled: false,
	})

	handlerCalled := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	middleware := svc.GlobalMiddleware()
	wrappedHandler := middleware(handler)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/test", http.NoBody)
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	assert.True(t, handlerCalled)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestService_MfaMiddleware_ReturnsNoopWhenDisabled(t *testing.T) {
	t.Parallel()

	svc := NewService(context.Background(), testLogger(), &Deps{
		IsEnabled: false,
	})

	handlerCalled := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	middleware := svc.MfaMiddleware()
	wrappedHandler := middleware(handler)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/test", http.NoBody)
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	assert.True(t, handlerCalled)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestKeyByAuthToken_ExtractsTokenFromBearerHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/test", http.NoBody)
	req.Header.Set("Authorization", "Bearer my-secret-token")

	key, err := keyByAuthToken(req)

	require.NoError(t, err)
	assert.Equal(t, "my-secret-token", key)
}

func TestNativeLimiterStaysDisabledOutsideHostedProduction(t *testing.T) {
	t.Parallel()
	assert.False(t, NativeLimiterEnabled(false, true))
	assert.False(t, NativeLimiterEnabled(true, false))
	assert.True(t, NativeLimiterEnabled(true, true))

	svc := NewService(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)), &Deps{})
	called := false
	handler := svc.Middleware(PresetRead)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/vaultix/secret-references", http.NoBody)
	req.RemoteAddr = "203.0.113.10:443"
	req.Header.Set("X-Real-IP", "198.51.100.7")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestKeyByAuthToken_FallsBackToIPWhenNoBearer(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/test", http.NoBody)
	req.RemoteAddr = "192.168.1.100:12345"
	req.Header.Set("X-Real-IP", "198.51.100.7")
	req.Header.Set("X-Forwarded-For", "198.51.100.7")

	key, err := keyByAuthToken(req)

	require.NoError(t, err)
	assert.Equal(t, "192.168.1.100", key)
}

func TestKeyByAuthToken_FallsBackToIPWhenShortHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/test", http.NoBody)
	req.Header.Set("Authorization", "Basic")
	req.RemoteAddr = "10.0.0.1:8080"

	key, err := keyByAuthToken(req)

	require.NoError(t, err)
	assert.Equal(t, "10.0.0.1", key)
}
