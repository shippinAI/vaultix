package vaultixref

import (
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/vaultix-cloud/api/internal/libs/errutil"
	"github.com/vaultix-cloud/api/internal/services/auth"
)

const (
	// ProjectBudget and ReferenceBudget match the public TypeScript route
	// configuration. They apply on self-hosted and hosted deployments.
	ProjectBudget   = 60
	ReferenceBudget = 60
	budgetWindow    = time.Minute
)

type window struct {
	start time.Time
	count int
}

// Limiter is the process-local budget for the native reference routes.
// The standalone sidecar is one process. A loopback MCP dispatch does not
// consume this budget because the public MCP route already counted it.
type Limiter struct {
	now    func() time.Time
	mu     sync.Mutex
	counts map[string]window
}

func NewLimiter(now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{now: now, counts: map[string]window{}}
}

func (l *Limiter) Allow(r *http.Request, route string, max int) error {
	if l == nil {
		return errutil.InternalServer("Reference rate limit is unavailable.")
	}
	if r.Header.Get(DispatchHeader) == DispatchMCP && loopbackPeer(r) {
		return nil
	}
	key := route + "\n" + auth.ClientIP(r)
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	current := l.counts[key]
	if current.start.IsZero() || now.Sub(current.start) >= budgetWindow {
		current = window{start: now}
	}
	current.count++
	l.counts[key] = current
	if current.count > max {
		return errutil.RateLimit("Rate limit exceeded")
	}
	return nil
}

func loopbackPeer(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
