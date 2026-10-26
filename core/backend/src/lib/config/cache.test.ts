import { describeCache, resolveCacheEnvironment } from "./cache";
import { resolveVaultixEnvironment } from "./vaultix-environment";

describe("Vaultix cache configuration", () => {
  test("defaults to a local Dragonfly endpoint without mutating the environment", () => {
    const input = {};
    expect(resolveCacheEnvironment(input).REDIS_URL).toBe("redis://127.0.0.1:6379");
    expect(describeCache(input)).toEqual({ provider: "dragonfly", topology: "standalone", tls: false });
    expect(input).toEqual({});
  });

  test("preserves explicit legacy Redis deployments", () => {
    const env = { REDIS_URL: "rediss://legacy.example:6379/2" };
    expect(resolveCacheEnvironment(env).REDIS_URL).toBe(env.REDIS_URL);
    expect(describeCache(env)).toEqual({ provider: "redis", topology: "standalone", tls: true });
  });

  test("does not send stale legacy credentials to a newly selected endpoint", () => {
    const env = resolveCacheEnvironment({
      REDIS_URL: "redis://old:6379",
      REDIS_PASSWORD: "old-secret",
      REDIS_USERNAME: "old-user",
      REDIS_READ_REPLICAS: "old:6380",
      VAULTIX_CACHE_URL: "redis://new:6379"
    });
    expect(env.REDIS_PASSWORD).toBeUndefined();
    expect(env.REDIS_USERNAME).toBeUndefined();
    expect(env.REDIS_READ_REPLICAS).toBeUndefined();
    expect(env.VAULTIX_CACHE_PROVIDER).toBe("dragonfly");
  });

  test("native cluster configuration replaces a stale standalone URL", () => {
    const env = resolveCacheEnvironment({
      REDIS_URL: "redis://old:6379",
      VAULTIX_CACHE_PROVIDER: "elasticache",
      VAULTIX_CACHE_CLUSTER_HOSTS: " cluster.example:6379, node.example:6380 ",
      VAULTIX_CACHE_USERNAME: "worker",
      VAULTIX_CACHE_PASSWORD: "never-return-this"
    });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.REDIS_CLUSTER_HOSTS).toBe("cluster.example:6379,node.example:6380");
    expect(env.REDIS_CLUSTER_ENABLE_TLS).toBe("true");
    expect(env.REDIS_CLUSTER_AWS_ELASTICACHE_DNS_LOOKUP_MODE).toBe("true");
    expect(env.REDIS_USERNAME).toBe("worker");
    expect(env.REDIS_PASSWORD).toBe("never-return-this");
  });

  test.each([
    { VAULTIX_CACHE_PROVIDER: "elasticache" },
    { VAULTIX_CACHE_PROVIDER: "elasticache", VAULTIX_CACHE_URL: "redis://primary:6379" },
    { VAULTIX_CACHE_PROVIDER: "elasticache", VAULTIX_CACHE_CLUSTER_HOSTS: "primary:6379", VAULTIX_CACHE_TLS: "false" },
    { VAULTIX_CACHE_PROVIDER: "elasticache", VAULTIX_CACHE_SENTINEL_HOSTS: "sentinel:26379" },
    { VAULTIX_CACHE_PROVIDER: "other" },
    { VAULTIX_CACHE_URL: "https://user:password@cache:6379" },
    { VAULTIX_CACHE_URL: "redis://cache:6379?password=hidden" },
    { VAULTIX_CACHE_CLUSTER_HOSTS: "cache:0" },
    { VAULTIX_CACHE_CLUSTER_HOSTS: "cache:65536" },
    { VAULTIX_CACHE_CLUSTER_HOSTS: "cache:6379," },
    { VAULTIX_CACHE_TLS: "yes" },
    { VAULTIX_CACHE_URL: "redis://cache:6379", VAULTIX_CACHE_CLUSTER_HOSTS: "cluster:6379" },
    { REDIS_URL: "redis://cache:6379", REDIS_SENTINEL_HOSTS: "sentinel:26379" }
  ])("rejects unsafe or ambiguous configuration %#", (env) => {
    expect(() => resolveCacheEnvironment(env)).toThrow();
  });

  test("supports authenticated Sentinel with separate TLS settings", () => {
    const env = resolveCacheEnvironment({
      VAULTIX_CACHE_PROVIDER: "redis",
      VAULTIX_CACHE_SENTINEL_HOSTS: "cache:26379",
      VAULTIX_CACHE_SENTINEL_MASTER_NAME: "main",
      VAULTIX_CACHE_SENTINEL_TLS: "true",
      VAULTIX_CACHE_SENTINEL_PASSWORD: "sentinel-secret",
      VAULTIX_CACHE_PASSWORD: "data-secret"
    });
    expect(env.REDIS_SENTINEL_MASTER_NAME).toBe("main");
    expect(env.REDIS_SENTINEL_PASSWORD).toBe("sentinel-secret");
    expect(env.REDIS_PASSWORD).toBe("data-secret");
    expect(describeCache(env)).toEqual({ provider: "redis", topology: "sentinel", tls: true });
  });

  test("reports metadata without credentials or endpoints", () => {
    expect(
      describeCache({
        VAULTIX_CACHE_PROVIDER: "elasticache",
        VAULTIX_CACHE_URL: "rediss://user:secret@private.example:6379"
      })
    ).toEqual({ provider: "elasticache", topology: "standalone", tls: true });
    try {
      resolveCacheEnvironment({ VAULTIX_CACHE_URL: "https://user:secret@private.example:6379" });
    } catch (error) {
      expect(String(error)).not.toMatch(/user|secret|private\.example/);
    }
  });

  test("old license configuration cannot enable billing or network entitlement calls", () => {
    const env = resolveVaultixEnvironment({
      LICENSE_SERVER_V2_MODE: "on",
      LICENSE_SERVER_URL: "https://old.example",
      LICENSE_KEY: "old-key",
      LICENSE_SERVER_KEY: "old-service-key"
    });
    expect(env.LICENSE_SERVER_V2_MODE).toBe("off");
    expect(env.LICENSE_SERVER_URL).toBe("");
    expect(env.LICENSE_KEY).toBe("");
    expect(env.LICENSE_SERVER_KEY).toBe("");
  });
});
