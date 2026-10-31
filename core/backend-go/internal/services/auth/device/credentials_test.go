package device_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/services/auth/device"
)

type credentialVectors struct {
	Secret                 []byte
	AccessVerificationKey  []byte
	RefreshVerificationKey []byte
	Resource               string
	Now                    int64
	Identity               device.AccessIdentity
	Access                 []struct {
		Name  string
		Valid bool
		Token string
	}
	Refresh []struct {
		Name       string
		Valid      bool
		Generation int64
		Token      string
	}
}

func credentialFixture(t *testing.T) (*device.Credentials, credentialVectors, *bytes.Buffer) {
	t.Helper()
	raw, err := os.ReadFile("testdata/credentials-v1.json")
	require.NoError(t, err)
	var vectors credentialVectors
	require.NoError(t, json.Unmarshal(raw, &vectors))
	var logs bytes.Buffer
	codec, err := device.NewCredentials(context.Background(), slog.New(slog.NewTextHandler(&logs, nil)), &device.CredentialsDeps{
		Secret: vectors.Secret, Resource: vectors.Resource, AccessLifetime: 15 * time.Minute,
	})
	require.NoError(t, err)
	return codec, vectors, &logs
}

func TestDeviceCredentials_IndependentAccessVectors(t *testing.T) {
	codec, vectors, logs := credentialFixture(t)
	for _, vector := range vectors.Access {
		t.Run(vector.Name, func(t *testing.T) {
			identity, err := codec.VerifyAccess(vector.Token, time.Unix(vectors.Now, 0))
			if !vector.Valid {
				require.ErrorIs(t, err, device.ErrInvalidCredential)
				require.Equal(t, device.AccessIdentity{}, identity)
				return
			}
			require.NoError(t, err)
			require.Equal(t, vectors.Identity.UserID, identity.UserID)
			require.Equal(t, vectors.Identity.SessionID, identity.SessionID)
			require.Equal(t, vectors.Identity.OrgID, identity.OrgID)
		})
	}
	require.Empty(t, logs.String())
}

func TestDeviceCredentials_IssuanceAndCryptographicSeparation(t *testing.T) {
	codec, vectors, logs := credentialFixture(t)
	now := time.Unix(vectors.Now, 0)
	encoded, err := codec.IssueAccess(&vectors.Identity, now, now.Add(10*time.Minute))
	require.NoError(t, err)
	// Independent fixture key verifies Go output without calling its verifier.
	token, err := jwt.Parse(encoded, func(_ *jwt.Token) (any, error) { return vectors.AccessVerificationKey, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(vectors.Resource), jwt.WithAudience(vectors.Resource), jwt.WithTimeFunc(func() time.Time { return now }))
	require.NoError(t, err)
	require.Equal(t, "vaultix-device-at+jwt", token.Header["typ"])
	claims, ok := token.Claims.(jwt.MapClaims)
	require.True(t, ok)
	require.Equal(t, device.AccessTokenType, claims["authTokenType"])
	require.Equal(t, "vaultix-cli", claims["client_id"])
	require.Equal(t, "vaultix:user", claims["scope"])
	require.NotContains(t, claims, "policyDigest")
	_, err = jwt.Parse(encoded, func(_ *jwt.Token) (any, error) { return vectors.Secret, nil }, jwt.WithTimeFunc(func() time.Time { return now }))
	require.Error(t, err, "legacy browser key must not accept native device access")
	identity, err := codec.VerifyAccess(encoded, now.Add(599*time.Second))
	require.NoError(t, err)
	require.Equal(t, vectors.Identity, identity)
	_, err = codec.VerifyAccess(encoded, now.Add(600*time.Second))
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	_, err = codec.VerifyAccess(encoded, now.Add(-time.Second))
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	other, err := device.NewCredentials(context.Background(), slog.New(slog.NewTextHandler(logs, nil)), &device.CredentialsDeps{
		Secret: vectors.Secret, Resource: "https://other.example.test", AccessLifetime: 15 * time.Minute,
	})
	require.NoError(t, err)
	_, err = other.VerifyAccess(encoded, now)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	for _, expiry := range []time.Time{now, now.Add(-time.Second), now.Add(16 * time.Minute)} {
		_, err = codec.IssueAccess(&vectors.Identity, now, expiry)
		require.ErrorIs(t, err, device.ErrInvalidCredential)
	}
	invalid := vectors.Identity
	invalid.SessionID = uuid.Nil
	_, err = codec.IssueAccess(&invalid, now, now.Add(time.Minute))
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	require.Empty(t, logs.String())
}

func TestDeviceCredentials_IndependentRefreshVectors(t *testing.T) {
	codec, vectors, logs := credentialFixture(t)
	for _, vector := range vectors.Refresh {
		t.Run(vector.Name, func(t *testing.T) {
			identity, err := codec.VerifyRefresh(vector.Token)
			if !vector.Valid {
				require.ErrorIs(t, err, device.ErrInvalidCredential)
				require.Equal(t, device.RefreshIdentity{}, identity)
				return
			}
			require.NoError(t, err)
			require.Equal(t, device.RefreshIdentity{UserID: vectors.Identity.UserID, SessionID: vectors.Identity.SessionID, Generation: vector.Generation}, identity)
		})
	}
	require.Empty(t, logs.String())
}

func TestDeviceCredentials_RefreshIntegrityAndGeneration(t *testing.T) {
	codec, vectors, logs := credentialFixture(t)
	want := device.RefreshIdentity{UserID: vectors.Identity.UserID, SessionID: vectors.Identity.SessionID, Generation: 8}
	first, err := codec.IssueRefresh(want)
	require.NoError(t, err)
	second, err := codec.IssueRefresh(want)
	require.NoError(t, err)
	require.NotEqual(t, first, second, "every issuance needs fresh random material")
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(first, "vxd1."))
	require.NoError(t, err)
	require.Len(t, raw, 104)
	mac := hmac.New(sha256.New, vectors.RefreshVerificationKey)
	_, err = mac.Write(raw[:72])
	require.NoError(t, err)
	require.True(t, hmac.Equal(raw[72:], mac.Sum(nil)), "independent fixture key must verify Go output")
	require.Equal(t, uint64(8), binary.BigEndian.Uint64(raw[32:40]))
	identity, err := codec.VerifyRefresh(first)
	require.NoError(t, err)
	require.Equal(t, want, identity)
	// Every authenticated field, nonce and MAC bit must be protected before a
	// lifecycle consumer considers an old generation a replay/revocation signal.
	for i := range raw {
		changed := bytes.Clone(raw)
		changed[i] ^= 1
		_, err = codec.VerifyRefresh("vxd1." + base64.RawURLEncoding.EncodeToString(changed))
		require.ErrorIs(t, err, device.ErrInvalidCredential)
	}
	for _, malformed := range []string{"", first + "=", "vxd2." + first[5:], first[:len(first)-1], strings.Repeat("a", 5000)} {
		_, err = codec.VerifyRefresh(malformed)
		require.ErrorIs(t, err, device.ErrInvalidCredential)
	}
	other, err := device.NewCredentials(context.Background(), slog.New(slog.NewTextHandler(logs, nil)), &device.CredentialsDeps{
		Secret: vectors.Secret, Resource: "https://other.example.test", AccessLifetime: time.Minute,
	})
	require.NoError(t, err)
	_, err = other.VerifyRefresh(first)
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	_, err = codec.VerifyAccess(first, time.Unix(vectors.Now, 0))
	require.ErrorIs(t, err, device.ErrInvalidCredential)
	require.Empty(t, logs.String())
}

func TestDeviceCredentials_InvalidConstructionAndZeroValue(t *testing.T) {
	_, vectors, logs := credentialFixture(t)
	logger := slog.New(slog.NewTextHandler(logs, nil))
	for _, deps := range []*device.CredentialsDeps{nil,
		{Secret: vectors.Secret, Resource: vectors.Resource, AccessLifetime: 0},
		{Secret: vectors.Secret, Resource: vectors.Resource, AccessLifetime: time.Millisecond},
		{Secret: vectors.Secret, Resource: vectors.Resource, AccessLifetime: 25 * time.Hour},
		{Secret: []byte("short"), Resource: vectors.Resource, AccessLifetime: time.Minute},
		{Secret: vectors.Secret, Resource: "http://unsafe.example.test", AccessLifetime: time.Minute},
	} {
		_, err := device.NewCredentials(context.Background(), logger, deps)
		require.ErrorIs(t, err, device.ErrUnavailable)
	}
	for _, codec := range []*device.Credentials{nil, {}} {
		_, err := codec.IssueRefresh(device.RefreshIdentity{UserID: vectors.Identity.UserID, SessionID: vectors.Identity.SessionID, Generation: 1})
		require.ErrorIs(t, err, device.ErrInvalidCredential)
		_, err = codec.VerifyRefresh(vectors.Refresh[0].Token)
		require.ErrorIs(t, err, device.ErrInvalidCredential)
		_, err = codec.VerifyAccess(vectors.Access[0].Token, time.Unix(vectors.Now, 0))
		require.ErrorIs(t, err, device.ErrInvalidCredential)
		_, err = codec.IssueAccess(&vectors.Identity, time.Unix(vectors.Now, 0), time.Unix(vectors.Now+60, 0))
		require.ErrorIs(t, err, device.ErrInvalidCredential)
	}
}
