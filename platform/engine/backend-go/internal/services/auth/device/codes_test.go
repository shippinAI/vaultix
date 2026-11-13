package device

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCodes_FormatAndSeparation(t *testing.T) {
	seen := make(map[string]bool)
	for range 1000 {
		secret, human := newCodes()
		require.Regexp(t, `^[A-Za-z0-9_-]{43}$`, secret)
		require.Regexp(t, `^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$`, human)
		require.True(t, validDeviceCode(secret))
		require.False(t, seen[secret])
		require.False(t, seen[human])
		seen[secret], seen[human] = true, true
		canonical, ok := canonicalUserCode("  " + strings.ToLower(human) + "  ")
		require.True(t, ok)
		require.Equal(t, strings.ReplaceAll(human, "-", ""), canonical)
	}
	s := &Service{hashKey: bytes.Repeat([]byte{1}, 32), resource: "https://vaultix.example.test"}
	first := s.digest("device-code", "fixture")
	require.Len(t, first, 32)
	require.NotEqual(t, first, s.digest("user-code", "fixture"))
	s.resource = "https://other.example.test"
	require.NotEqual(t, first, s.digest("device-code", "fixture"))
	s.resource = "https://vaultix.example.test"
	s.hashKey[0] = 2
	require.NotEqual(t, first, s.digest("device-code", "fixture"))
}

func TestCodes_RejectAmbiguity(t *testing.T) {
	for _, input := range []string{"", "ABCDE-FGHIJ", "ABCDE-FGHOJ", "12345-67890", "ABCDE--FGHJK", "ABCDE FGHJK", "ABCDE-FGHJKx", "ＡBCDEFGHJK", strings.Repeat("A", 33)} {
		_, ok := canonicalUserCode(input)
		require.False(t, ok, "invalid human code accepted")
	}
	for _, input := range []string{"", strings.Repeat("A", 42), strings.Repeat("A", 42) + "B", strings.Repeat("A", 43) + "=", strings.Repeat("!", 43)} {
		require.False(t, validDeviceCode(input), "invalid device code accepted")
	}
}

func TestResource_TrustedTransportAndBoundedIdentity(t *testing.T) {
	for _, input := range []string{"https://vaultix.cloud", "https://vaultix.example.test/prefix", "https://vaultix.example.test:8443", "http://127.0.0.1:8200", "http://[::1]:8200"} {
		require.True(t, validResource(input), input)
	}
	for _, input := range []string{"", "http://vaultix.cloud", "http://localhost:8200", "http://192.0.2.1", "https://vaultix.cloud/", "https://user@vaultix.cloud", "https://vaultix.cloud?", "https://vaultix.cloud#", "https://vaultix.cloud?x=1", "https://vaultix.cloud#x", "https://vaultix.cloud:", "https://vaultix.cloud:0", "https://vaultix.cloud:65536", " https://vaultix.cloud", "https://vaultix.cloud\n", "https:" + strings.Repeat("a", 2048)} {
		require.False(t, validResource(input), input)
	}
}

func TestCredentials_FormattedValuesAreRedacted(t *testing.T) {
	grant := Grant{DeviceCode: "device-canary", UserCode: "human-canary"}
	session := Session{AccessToken: "access-canary", RefreshToken: "refresh-canary"}
	for _, value := range []any{grant, &grant, session, &session} {
		formatted := fmt.Sprintf("%v %+v %#v", value, value, value)
		for _, canary := range []string{"device-canary", "human-canary", "access-canary", "refresh-canary"} {
			require.NotContains(t, formatted, canary)
		}
	}
}
