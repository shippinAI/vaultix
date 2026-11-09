package auth

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP returns the client address for audit and rate-limit attribution.
// Forwarded headers are accepted only from a loopback peer, which is the
// private Node ingress after it has replaced them with the validated socket
// address. A public or other private peer cannot supply X-Real-IP or
// X-Forwarded-For. X-Forwarded-For is never read: the ingress sends one
// X-Real-IP and a client-supplied forwarding chain is not an actor.
func ClientIP(r *http.Request) string {
	remoteHost := remoteHost(r.RemoteAddr)
	if ip := net.ParseIP(remoteHost); ip != nil && ip.IsLoopback() {
		if real := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); real != nil {
			return real.String()
		}
	}
	return remoteHost
}

func remoteHost(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}
