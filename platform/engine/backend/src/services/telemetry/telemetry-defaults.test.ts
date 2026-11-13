import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { initEnvConfig } from "@app/lib/config/env";

import { telemetryServiceFactory } from "./telemetry-service";

const mocks = vi.hoisted(() => ({ PostHog: vi.fn() }));
// This suite exercises configuration defaults, so it cuts the unused native crypto and server-config imports.
vi.mock("re2", () => ({ default: RegExp }));
vi.mock("@app/lib/crypto/cryptography", () => ({ crypto: {} }));
vi.mock("@app/lib/crypto/pqc", () => ({ initializePqcSupport: vi.fn() }));
vi.mock("@app/services/super-admin/super-admin-service", () => ({ getServerCfg: vi.fn() }));
vi.mock("posthog-node", () => ({ PostHog: mocks.PostHog }));

const required = {
  DB_CONNECTION_URI: "postgres://vaultix:vaultix@127.0.0.1:5432/vaultix",
  REDIS_URL: "redis://127.0.0.1:6379",
  ENCRYPTION_KEY: "00000000000000000000000000000000",
  AUTH_SECRET: "00000000000000000000000000000000",
  SITE_URL: "https://vaultix.invalid"
};
const service = () =>
  telemetryServiceFactory({
    keyStore: {},
    featureService: {}
  } as unknown as Parameters<typeof telemetryServiceFactory>[0]);
const load = (env: Record<string, string>) => {
  vi.stubEnv("TELEMETRY_ENABLED", env.TELEMETRY_ENABLED);
  vi.stubEnv("POSTHOG_PROJECT_API_KEY", env.POSTHOG_PROJECT_API_KEY);
  return initEnvConfig({} as never, {} as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.entries(required).forEach(([key, value]) => vi.stubEnv(key, value));
});
afterEach(() => vi.unstubAllEnvs());

test("an unconfigured environment keeps telemetry off with no analytics key", async () => {
  const config = await load({});

  expect(config.TELEMETRY_ENABLED).toBe(false);
  expect(config.POSTHOG_PROJECT_API_KEY).toBeUndefined();
  service();
  expect(mocks.PostHog).not.toHaveBeenCalled();
});

test("enabling telemetry without a key still creates no client", async () => {
  const config = await load({ TELEMETRY_ENABLED: "true" });

  expect(config.TELEMETRY_ENABLED).toBe(true);
  service();
  expect(mocks.PostHog).not.toHaveBeenCalled();
});

test("explicit opt-in with a key still reaches the configured project", async () => {
  await load({ TELEMETRY_ENABLED: "true", POSTHOG_PROJECT_API_KEY: "operator-project-key" });

  service();
  expect(mocks.PostHog).toHaveBeenCalledWith("operator-project-key", expect.anything());
});
