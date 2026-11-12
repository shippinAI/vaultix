package nomen

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Public fixtures: RFC 6238 SHA-1 vectors reduced to six digits, and separate
// otplib 12.0.1 output from the canonical Node image for its ten-byte profile.
func TestTOTPIndependentVectors(t *testing.T) {
	for _, vector := range []struct {
		epoch      int64
		short, rfc string
	}{
		{59, "263420", "287082"}, {1111111109, "343526", "081804"},
		{1111111111, "624539", "050471"}, {1234567890, "919219", "005924"},
		{2000000000, "068722", "279037"},
	} {
		for _, profile := range []struct{ name, secret, code string }{
			{"node-ten-byte", "GEZDGNBVGY3TQOJQ", vector.short},
			{"rfc-twenty-byte", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", vector.rfc},
		} {
			t.Run(fmt.Sprintf("%s-%d", profile.name, vector.epoch), func(t *testing.T) {
				for _, offset := range []int64{-30, 0, 30} {
					if vector.epoch+offset < 30 {
						continue
					}
					step, err := matchTOTP([]byte(profile.secret), profile.code, time.Unix(vector.epoch+offset, 0))
					require.NoError(t, err)
					require.Equal(t, vector.epoch/30, step)
				}
				_, err := matchTOTP([]byte(profile.secret), profile.code, time.Unix(vector.epoch+60, 0))
				require.ErrorIs(t, err, ErrLinkDenied)
			})
		}
	}
}

func TestTOTPRejectsMalformedInput(t *testing.T) {
	for _, code := range []string{"", "28708", "2870820", "28708a", "２８７０８２", " 287082"} {
		_, err := matchTOTP([]byte("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), code, time.Unix(59, 0))
		require.ErrorIs(t, err, ErrLinkDenied)
	}
	for _, secret := range []string{"", "GEZDGNBV", "!!!!!!!!!!!!!!!!!", strings.Repeat("A", 105)} {
		_, err := matchTOTP([]byte(secret), "287082", time.Unix(59, 0))
		require.ErrorIs(t, err, ErrLinkDenied)
	}
	_, err := matchTOTP([]byte("GEZDGNBVGY3TQOJQ"), "263420", time.Unix(-1, 0))
	require.ErrorIs(t, err, ErrLinkDenied)
}
