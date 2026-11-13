import { spawn } from "child_process";
import { EventEmitter } from "events";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { goSidecarPlugin } from "./go-sidecar";

vi.mock("child_process", () => ({ spawn: vi.fn() }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
const mockConfig = vi.hoisted(() => ({
  MAX_MACHINE_IDENTITY_TOKEN_AGE: 7200,
  LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: new Date("Mon, 04 May 2026 00:00:00 GMT"),
  DISABLE_AUDIT_LOG_GENERATION: false,
  GO_SIDECAR_SHADOW_ENABLED: false
}));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => mockConfig }));

afterEach(() => {
  vi.clearAllMocks();
  mockConfig.DISABLE_AUDIT_LOG_GENERATION = false;
  mockConfig.GO_SIDECAR_SHADOW_ENABLED = false;
});

describe("native authentication policy at process startup", () => {
  it("passes the issuer's resolved policy even when launcher overrides differ", async () => {
    const child = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const server = Fastify();
    try {
      await server.register(goSidecarPlugin, {
        enabled: true,
        binaryPath: "/fixture/go-sidecar",
        env: {
          MAX_MACHINE_IDENTITY_TOKEN_AGE: "30d",
          LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: "2030-01-01",
          PORT: "9999"
        }
      });
      await server.ready();
      expect(spawn).toHaveBeenCalledOnce();
      const [binary, args, options] = vi.mocked(spawn).mock.calls[0];
      expect(binary).toBe("/fixture/go-sidecar");
      expect(args).toEqual([]);
      expect({
        MAX_MACHINE_IDENTITY_TOKEN_AGE: options?.env?.MAX_MACHINE_IDENTITY_TOKEN_AGE,
        LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT:
          options?.env?.LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT,
        PORT: options?.env?.PORT,
        HOST: options?.env?.HOST
      }).toEqual({
        MAX_MACHINE_IDENTITY_TOKEN_AGE: "7200s",
        LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: "unix-ms:1777852800000",
        PORT: "4040",
        HOST: "127.0.0.1"
      });
    } finally {
      await server.close();
    }
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("does not start a native process when disabled", async () => {
    const server = Fastify();
    try {
      await server.register(goSidecarPlugin, { enabled: false });
      await server.ready();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});

describe("native audit process policy", () => {
  it.each([
    { shadow: false, disabled: false, expected: "false" },
    { shadow: true, disabled: false, expected: "true" },
    { shadow: false, disabled: true, expected: "true" },
    { shadow: true, disabled: true, expected: "true" }
  ])("preserves audit policy for shadow=$shadow disabled=$disabled", async ({ shadow, disabled, expected }) => {
    mockConfig.GO_SIDECAR_SHADOW_ENABLED = shadow;
    mockConfig.DISABLE_AUDIT_LOG_GENERATION = disabled;
    const child = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const server = Fastify();
    try {
      await server.register(goSidecarPlugin, { enabled: true, env: { DISABLE_AUDIT_LOG_GENERATION: "false" } });
      await server.ready();
      expect(spawn).toHaveBeenCalledOnce();
      expect(vi.mocked(spawn).mock.calls[0][2]?.env?.DISABLE_AUDIT_LOG_GENERATION).toBe(expected);
    } finally {
      await server.close();
    }
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
