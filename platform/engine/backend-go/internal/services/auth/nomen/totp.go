package nomen

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// matchTOTP follows the existing authenticator profile: SHA-1, six digits,
// thirty seconds, previous/current/next step. Return the highest matching step
// so rare equal adjacent codes have one consistent replay boundary.
func matchTOTP(secret []byte, code string, now time.Time) (int64, error) {
	if len(code) != 6 || len(secret) < 16 || len(secret) > 104 {
		return 0, ErrLinkDenied
	}
	for _, digit := range code {
		if digit < '0' || digit > '9' {
			return 0, ErrLinkDenied
		}
	}
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(string(secret)))
	if err != nil || len(key) < 10 || len(key) > 64 {
		return 0, ErrLinkDenied
	}
	defer clear(key)
	current := now.Unix() / 30
	if current < 1 {
		return 0, ErrLinkDenied
	}
	matched := int64(-1)
	for step := current - 1; step <= current+1; step++ {
		var counter [8]byte
		binary.BigEndian.PutUint64(counter[:], uint64(step))
		mac := hmac.New(sha1.New, key)
		_, _ = mac.Write(counter[:])
		digest := mac.Sum(nil)
		offset := digest[len(digest)-1] & 15
		value := binary.BigEndian.Uint32(digest[offset:offset+4]) & 0x7fffffff
		candidate := fmt.Sprintf("%06d", value%1000000)
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(code)) == 1 {
			matched = step
		}
	}
	if matched < 0 {
		return 0, ErrLinkDenied
	}
	return matched, nil
}
