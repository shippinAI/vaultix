package nomen

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"testing"
	"time"
)

func TestVerifyIDToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	kid := "k1"
	jwks := map[string]any{"keys": []any{rsaJWK(kid, &key.PublicKey)}}
	v := &Verifier{Issuer: "https://auth.shippin.ai", Audience: "vaultix", Keys: jwks}
	tok := sign(t, key, kid, map[string]any{
		"iss": "https://auth.shippin.ai", "sub": "acct-1", "aud": "vaultix",
		"exp": time.Now().Add(time.Hour).Unix(), "tenant_id": "ten-1",
	})
	id, err := v.Verify(context.Background(), tok)
	if err != nil {
		t.Fatal(err)
	}
	if id.Subject != "acct-1" || id.TenantID != "ten-1" {
		t.Fatalf("%+v", id)
	}
}

func TestRejectsWrongIssuer(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	kid := "k1"
	v := &Verifier{Issuer: "https://auth.shippin.ai", Audience: "vaultix", Keys: map[string]any{"keys": []any{rsaJWK(kid, &key.PublicKey)}}}
	tok := sign(t, key, kid, map[string]any{
		"iss": "https://evil.example", "sub": "acct-1", "aud": "vaultix",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(context.Background(), tok); err != ErrIssuer {
		t.Fatalf("got %v", err)
	}
}

func rsaJWK(kid string, pub *rsa.PublicKey) map[string]any {
	return map[string]any{
		"kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
	}
}

func sign(t *testing.T, key *rsa.PrivateKey, kid string, payload map[string]any) string {
	t.Helper()
	h, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": kid})
	p, _ := json.Marshal(payload)
	head := base64.RawURLEncoding.EncodeToString(h)
	body := base64.RawURLEncoding.EncodeToString(p)
	input := head + "." + body
	sum := sha256.Sum256([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}
