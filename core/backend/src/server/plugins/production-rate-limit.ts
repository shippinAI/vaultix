import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

import { getConfig } from "@app/lib/config/env";
import { buildRedisFromConfig } from "@app/lib/config/redis";

import { globalRateLimiterCfg } from "../config/rateLimiter";

// Admission is a deployment safety control, independent of software entitlements.
export const productionRateLimit = fp(async (server) => {
  const config = getConfig();
  if (!config.isProductionMode) return;
  if (!config.isRedisConfigured) throw new Error("Production request limits require a configured Vaultix cache.");

  const redis = buildRedisFromConfig(config, "rate-limiter", {
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  server.addHook("onClose", async () => redis.disconnect());
  await server.register(rateLimit, globalRateLimiterCfg(redis));
});
