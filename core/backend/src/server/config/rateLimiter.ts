import { createHash } from "node:crypto";

import type { RateLimitOptions, RateLimitPluginOptions } from "@fastify/rate-limit";
import type { Cluster, Redis } from "ioredis";

import { RateLimitError } from "@app/lib/errors";

export const globalRateLimiterCfg = (redis: Redis | Cluster): RateLimitPluginOptions => {
  return {
    errorResponseBuilder: (_, context) => {
      throw new RateLimitError({
        message: `Rate limit exceeded. Please try again in ${Math.ceil(context.ttl / 1000)} seconds`
      });
    },
    timeWindow: 60 * 1000,
    max: 600,
    redis,
    skipOnError: false,
    allowList: (req) => req.url === "/healthcheck" || req.url === "/api/status",
    keyGenerator: (req) => req.realIp
  };
};

// GET endpoints
export const readLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.readLimit,
  keyGenerator: (req) => req.realIp
};

// POST, PATCH, PUT, DELETE endpoints
export const writeLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.writeLimit,
  keyGenerator: (req) => req.realIp
};

// special endpoints
export const secretsLimit: RateLimitOptions = {
  // secrets, folders, secret imports
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.secretsLimit,
  keyGenerator: (req) => req.realIp
};

export const authRateLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.authRateLimit,
  keyGenerator: (req) => req.realIp
};

export const inviteUserRateLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.inviteUserRateLimit,
  keyGenerator: (req) => req.realIp
};

export const mfaRateLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.mfaRateLimit,
  keyGenerator: (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    // Preserve per-credential MFA budgets without persisting bearer credentials as cache keys.
    return token ? `token:${createHash("sha256").update(token).digest("hex")}` : req.realIp;
  }
};

// Public endpoints to avoid brute force attacks
export const publicEndpointLimit: RateLimitOptions = {
  // Read Shared Secrets
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.publicEndpointLimit,
  keyGenerator: (req) => req.realIp
};

export const publicSecretShareCreationLimit: RateLimitOptions = {
  // Create Shared Secrets
  timeWindow: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.realIp
};

export const userEngagementLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.realIp
};

export const invalidateCacheLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: 2,
  keyGenerator: (req) => req.realIp
};

// Makes spamming "request access" harder, preventing email DDoS
export const requestAccessLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: 10,
  keyGenerator: (req) => req.realIp
};

export const smtpRateLimit = ({
  keyGenerator = (req) => req.realIp
}: Pick<RateLimitOptions, "keyGenerator"> = {}): RateLimitOptions => ({
  timeWindow: 40 * 1000,
  hook: "preValidation",
  max: 2,
  keyGenerator
});

export const identityCreationLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.identityCreationLimit,
  keyGenerator: (req) => req.realIp
};

export const projectCreationLimit: RateLimitOptions = {
  timeWindow: 60 * 1000,
  hook: "preValidation",
  max: (req) => req.rateLimits.projectCreationLimit,
  keyGenerator: (req) => req.realIp
};
