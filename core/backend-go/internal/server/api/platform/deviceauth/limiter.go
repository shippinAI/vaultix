package deviceauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"

	"github.com/redis/go-redis/v9"
)

type RedisLimiter struct {
	Client   redis.Scripter
	Resource string
}

var admission = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end
return count
`)

func (l *RedisLimiter) Allow(ctx context.Context, operation, peer string) (bool, error) {
	limit := int64(30)
	if operation == "/token" {
		limit = 240
	}
	digest := sha256.Sum256([]byte(l.Resource + "\x00" + operation + "\x00" + peer))
	count, err := admission.Run(ctx, l.Client, []string{"vaultix:device:admission:v1:" + hex.EncodeToString(digest[:])}).Int64()
	return err == nil && count <= limit, err
}
