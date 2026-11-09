package auth

import (
	"net/http"
	"testing"
)

func TestClientIPIgnoresForwardedHeadersFromNonLoopbackPeers(t *testing.T) {
	request := &http.Request{RemoteAddr: "203.0.113.10:443", Header: http.Header{
		"X-Real-Ip":        []string{"198.51.100.7"},
		"X-Forwarded-For":  []string{"198.51.100.7, 203.0.113.10"},
		"Cf-Connecting-Ip": []string{"198.51.100.7"},
	}}
	if got := ClientIP(request); got != "203.0.113.10" {
		t.Fatalf("spoofed forwarded address was accepted: %s", got)
	}
}

func TestClientIPUsesIngressAddressFromLoopbackPeer(t *testing.T) {
	request := &http.Request{RemoteAddr: "127.0.0.1:4040", Header: http.Header{
		"X-Real-Ip":       []string{"203.0.113.20"},
		"X-Forwarded-For": []string{"198.51.100.7"},
	}}
	if got := ClientIP(request); got != "203.0.113.20" {
		t.Fatalf("loopback ingress address: got %s", got)
	}
}

func TestClientIPIgnoresAnInvalidIngressAddress(t *testing.T) {
	request := &http.Request{RemoteAddr: "127.0.0.1:4040", Header: http.Header{
		"X-Real-Ip": []string{"not-an-address"},
	}}
	if got := ClientIP(request); got != "127.0.0.1" {
		t.Fatalf("invalid ingress address replaced the socket: %s", got)
	}
}

func TestClientIPUsesLoopbackSocketWhenIngressDidNotSetAnAddress(t *testing.T) {
	request := &http.Request{RemoteAddr: "[::1]:4040", Header: http.Header{
		"X-Forwarded-For": []string{"198.51.100.7"},
	}}
	if got := ClientIP(request); got != "::1" {
		t.Fatalf("forwarding chain replaced the loopback socket: %s", got)
	}
}
