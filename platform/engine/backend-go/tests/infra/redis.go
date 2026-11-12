//go:build integration

package infra

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// RedisService provides the Redis protocol used by Dragonfly and Redis fixtures.
type RedisService struct {
	container testcontainers.Container
	url       string
}

func (r *RedisService) URL() string { return r.url }

func (r *RedisService) Client() redis.UniversalClient {
	opts, err := redis.ParseURL(r.url)
	if err != nil {
		panic(fmt.Sprintf("invalid redis URL %q: %v", r.url, err))
	}
	return redis.NewClient(opts)
}

func startRedis(ctx context.Context, networkName string) (*RedisService, error) {
	image := "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2"
	command := []string{"--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=1gb", "--proactor_threads=2"}
	switch provider := os.Getenv("VAULTIX_TEST_CACHE_PROVIDER"); provider {
	case "", "dragonfly":
	case "redis":
		image = "redis:7.4-alpine"
		command = []string{"redis-server", "--maxmemory-policy", "noeviction"}
	default:
		return nil, fmt.Errorf("unsupported VAULTIX_TEST_CACHE_PROVIDER %q: use dragonfly or redis", provider)
	}
	req := testcontainers.ContainerRequest{
		Image:        image,
		Cmd:          command,
		ExposedPorts: []string{"6379/tcp"},
		Networks:     []string{networkName},
		NetworkAliases: map[string][]string{
			networkName: {"redis"},
		},
		WaitingFor: wait.ForListeningPort("6379/tcp").WithStartupTimeout(60 * time.Second),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		return nil, fmt.Errorf("starting redis: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, fmt.Errorf("getting redis host: %w", err)
	}

	mappedPort, err := container.MappedPort(ctx, "6379/tcp")
	if err != nil {
		return nil, fmt.Errorf("getting redis port: %w", err)
	}

	url := fmt.Sprintf("redis://%s:%d", host, mappedPort.Int())

	return &RedisService{
		container: container,
		url:       url,
	}, nil
}
