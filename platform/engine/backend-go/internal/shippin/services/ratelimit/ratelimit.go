package ratelimit

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/httprate"
	"github.com/redis/go-redis/v9"

	"github.com/vaultix-cloud/api/internal/services/auth"
)

const (
	defaultWindowLength = time.Minute
	defaultPrefixKey    = "httprate"
)

// Service provides rate limiting middleware with plan-based dynamic limits.
type Service struct {
	counter    *RedisCounter
	limiter    *httprate.RateLimiter
	enabled    bool
	logger     *slog.Logger
}

// Deps holds the dependencies for the rate limit service.
type Deps struct {
	Redis      redis.UniversalClient
	IsEnabled  bool
}

// NativeLimiterEnabled is the current native limiter gate. Self-hosted and
// non-production processes stay disabled because public Vaultix routes use the
// TypeScript limiter. Enabling this for every self-hosted Go route would not
// match those route budgets.
func NativeLimiterEnabled(isCloud, isProduction bool) bool {
	return isCloud && isProduction
}

// NewService creates a new rate limit service.
// Rate limiting is only active when enabled (cloud + production).
func NewService(_ context.Context, logger *slog.Logger, deps *Deps) *Service {
	if !deps.IsEnabled {
		return &Service{
			enabled: false,
			logger:  logger,
		}
	}

	counter := NewRedisCounter(&RedisCounterConfig{
		Client:    deps.Redis,
		PrefixKey: defaultPrefixKey,
		Logger:    logger,
	})

	limiter := httprate.NewRateLimiter(
		DefaultLimits.ReadLimit,
		defaultWindowLength,
		httprate.WithKeyFuncs(func(r *http.Request) (string, error) {
			return auth.ClientIP(r), nil
		}),
		httprate.WithLimitCounter(counter),
		httprate.WithLimitHandler(rateLimitedHandler),
	)

	return &Service{
		counter:    counter,
		limiter:    limiter,
		enabled:    true,
		logger:     logger,
	}
}

// Middleware returns rate limit middleware for the given preset.
// It chains: InjectLimit (sets dynamic limit in context) → httprate limiter.
func (s *Service) Middleware(preset Preset) func(http.Handler) http.Handler {
	if !s.enabled {
		return noopMiddleware
	}

	return func(next http.Handler) http.Handler {
		// Chain: inject limit → apply rate limiter
		return s.injectLimit(preset)(s.limiter.Handler(next))
	}
}

// GlobalMiddleware returns the baseline rate limiter (600/min).
// Use this for routes that don't need plan-based dynamic limits.
func (s *Service) GlobalMiddleware() func(http.Handler) http.Handler {
	if !s.enabled {
		return noopMiddleware
	}
	return s.limiter.Handler
}

// injectLimit returns middleware that sets the rate limit in context for the preset.
func (s *Service) injectLimit(preset Preset) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			limit := DefaultLimits.Get(preset)

			ctx := httprate.WithRequestLimit(r.Context(), limit)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// MfaMiddleware returns rate limit middleware for MFA endpoints.
// Keys by authorization token instead of IP address.
func (s *Service) MfaMiddleware() func(http.Handler) http.Handler {
	if !s.enabled {
		return noopMiddleware
	}

	mfaLimiter := httprate.NewRateLimiter(
		DefaultLimits.MfaRateLimit,
		defaultWindowLength,
		httprate.WithKeyFuncs(keyByAuthToken),
		httprate.WithLimitCounter(s.counter),
		httprate.WithLimitHandler(rateLimitedHandler),
	)

	return func(next http.Handler) http.Handler {
		return s.injectLimit(PresetMfa)(mfaLimiter.Handler(next))
	}
}

// keyByAuthToken extracts the bearer token from the Authorization header for rate limiting.
// Falls back to IP if no token present.
func keyByAuthToken(r *http.Request) (string, error) {
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:], nil
	}
	return auth.ClientIP(r), nil
}

func rateLimitedHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"statusCode":429,"message":"Rate limit exceeded. Please try again later."}`))
}

func noopMiddleware(next http.Handler) http.Handler {
	return next
}

