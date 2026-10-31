package device

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

const userAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func newCodes() (deviceCode, userCode string) {
	var secret [32]byte
	var short [10]byte
	_, _ = rand.Read(secret[:])
	_, _ = rand.Read(short[:])
	// Rejection sampling keeps every symbol uniform even if the alphabet changes.
	for i := range short {
		for int(short[i]) >= 256-256%len(userAlphabet) {
			_, _ = rand.Read(short[i : i+1])
		}
		short[i] = userAlphabet[int(short[i])%len(userAlphabet)]
	}
	return base64.RawURLEncoding.EncodeToString(secret[:]), string(short[:5]) + "-" + string(short[5:])
}

func canonicalUserCode(raw string) (string, bool) {
	if len(raw) > 32 {
		return "", false
	}
	code := strings.ToUpper(strings.TrimSpace(raw))
	if len(code) == 11 && code[5] == '-' {
		code = code[:5] + code[6:]
	}
	if len(code) != 10 {
		return "", false
	}
	for _, symbol := range code {
		if !strings.ContainsRune(userAlphabet, symbol) {
			return "", false
		}
	}
	return code, true
}

func validDeviceCode(code string) bool {
	if len(code) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(code)
	return err == nil && len(decoded) == 32
}

func validResource(resource string) bool {
	if len(resource) > 2048 || strings.TrimSpace(resource) != resource || strings.HasSuffix(resource, "/") || strings.ContainsAny(resource, "?#") {
		return false
	}
	u, err := url.Parse(resource)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" {
		return false
	}
	if strings.HasSuffix(u.Host, ":") {
		return false
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return false
		}
	}
	if u.Scheme == "https" {
		return true
	}
	ip, err := netip.ParseAddr(u.Hostname())
	return u.Scheme == "http" && err == nil && ip.IsLoopback()
}

func (s *Service) digest(kind, code string) []byte {
	mac := hmac.New(sha256.New, s.hashKey)
	_, _ = mac.Write([]byte("vaultix.device.v1\x00" + kind + "\x00" + s.resource + "\x00" + ClientID + "\x00" + code))
	return mac.Sum(nil)
}
