package nomen

import (
	"encoding/json"
	"strings"
	"time"
)

// Claims contains only validated provider metadata. It deliberately has no
// Vaultix user, organization, role, session token or secret-value fields.
type Claims struct {
	Issuer    string
	Subject   string
	ClientID  string
	ExpiresAt time.Time
	Scopes    []string
}

func (v *Verifier) claims(fields map[string]json.RawMessage, now time.Time) (*Claims, error) {
	var active bool
	if string(fields["active"]) != "true" && string(fields["active"]) != "false" {
		return nil, ErrUnavailable
	}
	if json.Unmarshal(fields["active"], &active) != nil {
		return nil, ErrUnavailable
	}
	if !active {
		return nil, ErrInvalidToken
	}
	var issuer, subject, clientID, tokenType, scope string
	for name, target := range map[string]*string{"iss": &issuer, "sub": &subject, "client_id": &clientID, "token_type": &tokenType, "scope": &scope} {
		if json.Unmarshal(fields[name], target) != nil || *target == "" {
			return nil, ErrUnavailable
		}
	}
	// OIDC subject identifiers are case-sensitive ASCII strings, at most 255
	// characters. Do not normalize Unicode/replacement characters into a binding.
	if issuer != v.issuer || !identifier(subject, 255) || strings.ContainsFunc(subject, func(r rune) bool { return r > 127 }) || !v.clients[clientID] || tokenType != "Bearer" {
		return nil, ErrInvalidToken
	}
	var audiences []string
	var singleAudience string
	if json.Unmarshal(fields["aud"], &singleAudience) == nil && singleAudience != "" {
		audiences = []string{singleAudience}
	} else if json.Unmarshal(fields["aud"], &audiences) != nil || len(audiences) == 0 {
		return nil, ErrUnavailable
	}
	intended := false
	for _, audience := range audiences {
		if !identifier(audience, 2048) {
			return nil, ErrUnavailable
		}
		intended = intended || audience == v.audience
	}
	if !intended {
		return nil, ErrInvalidToken
	}
	var expires, issued, notBefore int64
	for name, target := range map[string]*int64{"exp": &expires, "iat": &issued} {
		if string(fields[name]) == "null" || json.Unmarshal(fields[name], target) != nil || *target < 0 || *target > 253402300799 {
			return nil, ErrUnavailable
		}
	}
	if raw, ok := fields["nbf"]; ok {
		if string(raw) == "null" || json.Unmarshal(raw, &notBefore) != nil || notBefore < 0 || notBefore > 253402300799 {
			return nil, ErrUnavailable
		}
	}
	// No expiry grace period: the 30-second allowance only covers future iat/nbf.
	if expires <= now.Unix() || issued > now.Add(30*time.Second).Unix() || notBefore > now.Add(30*time.Second).Unix() || expires <= issued || expires <= notBefore {
		return nil, ErrInvalidToken
	}
	if len(scope) > 8192 {
		return nil, ErrUnavailable
	}
	scopes := strings.Split(scope, " ")
	present := make(map[string]bool)
	for _, item := range scopes {
		if !validScope(item) {
			return nil, ErrUnavailable
		}
		present[item] = true
	}
	for required := range v.scopes {
		if !present[required] {
			return nil, ErrInvalidToken
		}
	}
	return &Claims{Issuer: issuer, Subject: subject, ClientID: clientID, ExpiresAt: time.Unix(expires, 0), Scopes: scopes}, nil
}

func validScope(scope string) bool {
	if scope == "" || len(scope) > 255 {
		return false
	}
	for _, value := range scope {
		if value < 0x21 || value > 0x7e || value == '"' || value == '\\' {
			return false
		}
	}
	return true
}
