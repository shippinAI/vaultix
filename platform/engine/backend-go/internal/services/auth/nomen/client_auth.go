package nomen

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"reflect"
	"time"
)

type ClientAuthMethod string

const (
	PrivateKeyJWT     ClientAuthMethod = "private_key_jwt"
	ClientSecretBasic ClientAuthMethod = "client_secret_basic"
)

// ClientCredentials belong exclusively to the resource server, never the CLI.
// A signer/key change requires constructing a new verifier. Callers must not
// mutate a signer while it is in use. No key material is loaded from the network.
type ClientCredentials struct {
	Method   ClientAuthMethod `json:"-"`
	ClientID string           `json:"-"`
	Secret   string           `json:"-"`
	KeyID    string           `json:"-"`
	Signer   crypto.Signer    `json:"-"`
}

func (ClientCredentials) String() string   { return "Nomen resource credentials (redacted)" }
func (ClientCredentials) GoString() string { return "Nomen resource credentials (redacted)" }

func (c *ClientCredentials) validate() error {
	if !identifier(c.ClientID, 255) {
		return ErrConfiguration
	}
	switch c.Method {
	case ClientSecretBasic:
		if !identifier(c.Secret, 4096) || c.Signer != nil || c.KeyID != "" {
			return ErrConfiguration
		}
	case PrivateKeyJWT:
		if c.Signer == nil || !identifier(c.KeyID, 255) || c.Secret != "" {
			return ErrConfiguration
		}
		if value := reflect.ValueOf(c.Signer); value.Kind() == reflect.Pointer && value.IsNil() {
			return ErrConfiguration
		}
		key, ok := c.Signer.Public().(*rsa.PublicKey)
		if !ok || key == nil || key.N == nil || key.N.BitLen() < 2048 || key.E < 65537 {
			return ErrConfiguration
		}
	default:
		return ErrConfiguration
	}
	return nil
}

func (c *ClientCredentials) addAssertion(form url.Values, issuer string, now time.Time) error {
	if c.Method == ClientSecretBasic {
		return nil
	}
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return ErrUnavailable
	}
	header, err := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": c.KeyID})
	if err != nil {
		return ErrUnavailable
	}
	claims, err := json.Marshal(map[string]any{
		"iss": c.ClientID, "sub": c.ClientID, "aud": issuer,
		"iat": now.Unix(), "exp": now.Add(time.Minute).Unix(), "jti": hex.EncodeToString(nonce[:]),
	})
	if err != nil {
		return ErrUnavailable
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := c.Signer.Sign(rand.Reader, digest[:], crypto.SHA256)
	if err != nil {
		return ErrUnavailable
	}
	form.Set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer")
	form.Set("client_assertion", unsigned+"."+base64.RawURLEncoding.EncodeToString(signature))
	return nil
}
