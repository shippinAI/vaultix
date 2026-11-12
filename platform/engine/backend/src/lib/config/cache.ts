export type CacheProvider = "dragonfly" | "redis" | "elasticache";
export type CacheTopology = "standalone" | "cluster" | "sentinel";

const aliases = {
  VAULTIX_CACHE_URL: "REDIS_URL",
  VAULTIX_CACHE_USERNAME: "REDIS_USERNAME",
  VAULTIX_CACHE_PASSWORD: "REDIS_PASSWORD",
  VAULTIX_CACHE_CLUSTER_HOSTS: "REDIS_CLUSTER_HOSTS",
  VAULTIX_CACHE_TLS: "REDIS_CLUSTER_ENABLE_TLS",
  VAULTIX_CACHE_SENTINEL_HOSTS: "REDIS_SENTINEL_HOSTS",
  VAULTIX_CACHE_SENTINEL_MASTER_NAME: "REDIS_SENTINEL_MASTER_NAME",
  VAULTIX_CACHE_SENTINEL_TLS: "REDIS_SENTINEL_ENABLE_TLS",
  VAULTIX_CACHE_SENTINEL_USERNAME: "REDIS_SENTINEL_USERNAME",
  VAULTIX_CACHE_SENTINEL_PASSWORD: "REDIS_SENTINEL_PASSWORD"
} as const;

const endpoints = ["REDIS_URL", "REDIS_CLUSTER_HOSTS", "REDIS_SENTINEL_HOSTS"] as const;
const present = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export const resolveCacheEnvironment = <T extends Record<string, unknown>>(input: T) => {
  const env: Record<string, unknown> = { ...input };
  const hasNativeEndpoint = ["VAULTIX_CACHE_URL", "VAULTIX_CACHE_CLUSTER_HOSTS", "VAULTIX_CACHE_SENTINEL_HOSTS"].some(
    (key) => present(input[key])
  );
  if (hasNativeEndpoint) {
    Object.values(aliases).forEach((key) => {
      delete env[key];
    });
    delete env.REDIS_READ_REPLICAS;
    delete env.REDIS_CLUSTER_AWS_ELASTICACHE_DNS_LOOKUP_MODE;
  }

  Object.entries(aliases).forEach(([key, legacy]) => {
    if (present(input[key])) env[legacy] = input[key];
  });

  const provider =
    input.VAULTIX_CACHE_PROVIDER ??
    (!hasNativeEndpoint && endpoints.some((key) => present(input[key])) ? "redis" : "dragonfly");
  if (!["dragonfly", "redis", "elasticache"].includes(String(provider))) {
    throw new Error("VAULTIX_CACHE_PROVIDER must be dragonfly, redis, or elasticache.");
  }
  env.VAULTIX_CACHE_PROVIDER = provider;

  const configured = endpoints.filter((key) => present(env[key]));
  if (configured.length > 1) throw new Error("Configure one cache topology: URL, cluster hosts, or Sentinel hosts.");
  if (!configured.length) {
    if (provider === "elasticache")
      throw new Error("ElastiCache requires VAULTIX_CACHE_URL or VAULTIX_CACHE_CLUSTER_HOSTS.");
    env.REDIS_URL = "redis://127.0.0.1:6379";
  }

  if (present(env.REDIS_URL)) {
    let url: URL;
    try {
      url = new URL(env.REDIS_URL);
    } catch {
      throw new Error("VAULTIX_CACHE_URL must be a valid redis:// or rediss:// URL.");
    }
    if (
      !["redis:", "rediss:"].includes(url.protocol) ||
      !url.hostname ||
      url.search ||
      url.hash ||
      !/^\/(\d+)?$|^$/.test(url.pathname)
    ) {
      throw new Error("VAULTIX_CACHE_URL must use redis:// or rediss:// with an optional database number.");
    }
    if (provider === "elasticache" && url.protocol !== "rediss:") {
      throw new Error("ElastiCache requires TLS. Use a rediss:// primary endpoint.");
    }
  }

  ["REDIS_CLUSTER_HOSTS", "REDIS_SENTINEL_HOSTS"].forEach((key) => {
    if (!present(env[key])) return;
    const hosts = (env[key] as string).split(",").map((host) => host.trim());
    if (
      hosts.length > 100 ||
      hosts.some((host) => {
        const match = /^([a-zA-Z0-9._-]+):(\d{1,5})$/.exec(host);
        return !match || Number(match[2]) < 1 || Number(match[2]) > 65535;
      })
    )
      throw new Error("Cache hosts must be comma-separated hostname:port pairs with ports from 1 to 65535.");
    env[key] = hosts.join(",");
  });

  ["REDIS_CLUSTER_ENABLE_TLS", "REDIS_SENTINEL_ENABLE_TLS"].forEach((key) => {
    if (present(env[key]) && !["true", "false"].includes(env[key] as string)) {
      throw new Error("Cache TLS settings must be true or false.");
    }
  });
  if (provider === "elasticache") {
    if (present(env.REDIS_SENTINEL_HOSTS))
      throw new Error("ElastiCache does not use Sentinel. Configure its primary or cluster endpoint.");
    if (env.REDIS_CLUSTER_ENABLE_TLS === "false") throw new Error("ElastiCache requires VAULTIX_CACHE_TLS=true.");
    env.REDIS_CLUSTER_ENABLE_TLS = "true";
    env.REDIS_CLUSTER_AWS_ELASTICACHE_DNS_LOOKUP_MODE = "true";
  }
  return env;
};

export const describeCache = (
  input: Record<string, unknown>
): { provider: CacheProvider; topology: CacheTopology; tls: boolean } => {
  const env = resolveCacheEnvironment(input);
  let topology: CacheTopology = "standalone";
  if (present(env.REDIS_CLUSTER_HOSTS)) topology = "cluster";
  else if (present(env.REDIS_SENTINEL_HOSTS)) topology = "sentinel";
  return {
    provider: env.VAULTIX_CACHE_PROVIDER as CacheProvider,
    topology,
    tls:
      topology === "standalone"
        ? String(env.REDIS_URL).startsWith("rediss:")
        : env[topology === "cluster" ? "REDIS_CLUSTER_ENABLE_TLS" : "REDIS_SENTINEL_ENABLE_TLS"] === "true"
  };
};
