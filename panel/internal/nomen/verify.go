package nomen

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	ErrBadToken = errors.New("nomen: bad token")
	ErrIssuer   = errors.New("nomen: issuer mismatch")
	ErrAudience = errors.New("nomen: audience mismatch")
	ErrExpired  = errors.New("nomen: token expired")
)

// Identity is a verified Nomen principal. Vaultix stores nothing about accounts.
type Identity struct {
	Subject  string
	TenantID string
	Email    string
}

type Verifier struct {
	Issuer   string
	Audience string
	JWKSURL  string
	HTTP     *http.Client
	Keys     map[string]any // optional injected JWKS {keys:[...]} for tests

	mu       sync.Mutex
	cached   map[string]any
	cachedAt time.Time
}

func (v *Verifier) Verify(ctx context.Context, raw string) (Identity, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return Identity{}, ErrBadToken
	}
	header, err := decodeJSON(parts[0])
	if err != nil {
		return Identity{}, ErrBadToken
	}
	payload, err := decodeJSON(parts[1])
	if err != nil {
		return Identity{}, ErrBadToken
	}
	if str(header["alg"]) != "RS256" || str(header["kid"]) == "" {
		return Identity{}, ErrBadToken
	}
	now := time.Now().Unix()
	iss := str(payload["iss"])
	sub := str(payload["sub"])
	if sub == "" {
		return Identity{}, ErrBadToken
	}
	if v.Issuer != "" && iss != strings.TrimRight(v.Issuer, "/") {
		return Identity{}, ErrIssuer
	}
	if v.Audience != "" && !audOK(payload["aud"], v.Audience) {
		return Identity{}, ErrAudience
	}
	exp := int64Num(payload["exp"])
	if exp > 0 && now >= exp {
		return Identity{}, ErrExpired
	}
	jwks, err := v.jwks(ctx)
	if err != nil {
		return Identity{}, err
	}
	pub, err := keyFor(jwks, str(header["kid"]))
	if err != nil {
		return Identity{}, ErrBadToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Identity{}, ErrBadToken
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig); err != nil {
		return Identity{}, ErrBadToken
	}
	return Identity{
		Subject:  sub,
		TenantID: str(payload["tenant_id"]),
		Email:    str(payload["email"]),
	}, nil
}

func (v *Verifier) jwks(ctx context.Context) (map[string]any, error) {
	if v.Keys != nil {
		return v.Keys, nil
	}
	v.mu.Lock()
	if v.cached != nil && time.Since(v.cachedAt) < 5*time.Minute {
		out := v.cached
		v.mu.Unlock()
		return out, nil
	}
	v.mu.Unlock()
	url := v.JWKSURL
	if url == "" && v.Issuer != "" {
		url = strings.TrimRight(v.Issuer, "/") + "/.well-known/jwks.json"
	}
	if url == "" {
		return nil, errors.New("nomen: no JWKS")
	}
	httpClient := v.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nomen: jwks status %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var jwks map[string]any
	if err := json.Unmarshal(body, &jwks); err != nil {
		return nil, ErrBadToken
	}
	v.mu.Lock()
	v.cached, v.cachedAt = jwks, time.Now()
	v.mu.Unlock()
	return jwks, nil
}

func keyFor(jwks map[string]any, kid string) (*rsa.PublicKey, error) {
	keys, _ := jwks["keys"].([]any)
	for _, raw := range keys {
		k, _ := raw.(map[string]any)
		if str(k["kid"]) != kid || str(k["kty"]) != "RSA" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(str(k["n"]))
		if err != nil {
			return nil, err
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(str(k["e"]))
		if err != nil {
			return nil, err
		}
		for len(eBytes) < 8 {
			eBytes = append([]byte{0}, eBytes...)
		}
		e := int(binary.BigEndian.Uint64(eBytes[len(eBytes)-8:]))
		return &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}, nil
	}
	return nil, ErrBadToken
}

func decodeJSON(seg string) (map[string]any, error) {
	b, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func int64Num(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	default:
		return 0
	}
}

func audOK(aud any, want string) bool {
	switch v := aud.(type) {
	case string:
		return v == want
	case []any:
		for _, x := range v {
			if str(x) == want {
				return true
			}
		}
	}
	return false
}
