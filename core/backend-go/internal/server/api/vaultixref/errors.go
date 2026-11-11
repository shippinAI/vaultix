package vaultixref

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/vaultix-cloud/api/internal/libs/errutil"
)

const (
	messageUnauthorized = "Sign in to access your vault."
	messageUnavailable  = "This resource is unavailable."
	messageInvalid      = "Invalid Vaultix request."
	messageRateLimit    = "Too many requests. Wait for the Retry-After interval and try again."
	messageFailed       = "Vaultix could not complete the request."
)

// DispatchHeader marks a loopback MCP call whose budget was already counted
// by the public ingress. It is not an actor and is ignored from any other peer.
const DispatchHeader = "X-Vaultix-Dispatch"

const DispatchMCP = "mcp"

func writePublicError(logger *slog.Logger, w http.ResponseWriter, r *http.Request, err error) {
	status := http.StatusInternalServerError
	var httpErr *errutil.Error
	if errors.As(err, &httpErr) && httpErr.Status >= 400 && httpErr.Status < 500 {
		status = httpErr.Status
	}
	message := messageFailed
	switch status {
	case http.StatusUnauthorized:
		message = messageUnauthorized
	case http.StatusForbidden, http.StatusNotFound:
		status = http.StatusNotFound
		message = messageUnavailable
	case http.StatusBadRequest:
		message = messageInvalid
	case http.StatusTooManyRequests:
		message = messageRateLimit
		w.Header().Set("Retry-After", "60")
	default:
		status = http.StatusInternalServerError
		if logger != nil {
			logger.ErrorContext(r.Context(), "vaultix reference request failed", slog.String("errorType", errorName(err)))
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func errorName(err error) string {
	var httpErr *errutil.Error
	if errors.As(err, &httpErr) && httpErr.Name != "" {
		return httpErr.Name
	}
	if err == nil {
		return "Unknown"
	}
	return "Error"
}
