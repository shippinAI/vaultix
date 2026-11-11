import { getVaultixCatalog, getVaultixConfigure, getVaultixConnections } from "./catalog";
import { getVaultixFeatures } from "./features";
import { getVaultixGuidance } from "./guidance";
import { handleVaultixMcp } from "./mcp";

const call = (method: string, params?: unknown) => handleVaultixMcp({ jsonrpc: "2.0", id: 1, method, params });

describe("Clyffy native MCP", () => {
  test("initializes with a supported version and clear capability boundaries", () => {
    const response = call("initialize", {
      protocolVersion: "2025-03-26",
      clientInfo: { name: "codex", version: "1" },
      capabilities: {}
    });
    expect(response).toMatchObject({
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "vaultix-clyffy" },
        capabilities: { tools: { listChanged: false } }
      }
    });
    expect(JSON.stringify(response)).toContain("cannot create, read values, rotate, inject, or delete secrets");
  });

  test("MCP and UI use the same catalog and configure steps", () => {
    for (const [name, expected] of [
      ["vaultix.guidance.get", getVaultixGuidance()],
      ["vaultix.catalog.get", getVaultixCatalog()],
      ["vaultix.configure.show", getVaultixConfigure()],
      ["vaultix.connections.get", getVaultixConnections()]
    ] as const) {
      expect(call("tools/call", { name, arguments: {} })).toMatchObject({
        result: { content: [{ type: "text", text: JSON.stringify(expected) }], isError: false }
      });
    }
  });

  test("lists only metadata tools with empty input schemas", () => {
    const listed = JSON.stringify(call("tools/list"));
    expect(listed).toContain('"readOnlyHint":true');
    expect(listed).toContain('"additionalProperties":false');
    expect(listed).not.toMatch(/vaultix\.(inject|redeem|secret|source\.act)/);
    const names = (
      call("tools/list") as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } }
    ).result.tools;
    expect(names.map((tool) => tool.name)).toEqual([
      "vaultix.warp.list",
      "vaultix.auth.options.get",
      "vaultix.guidance.get",
      "vaultix.catalog.get",
      "vaultix.configure.show",
      "vaultix.connections.get",
      "vaultix.specialist.instructions",
      "vaultix.learning.profile.get"
    ]);
    expect(names.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    const connections = JSON.stringify(getVaultixConnections());
    expect(connections).toContain("POST /api/v1/vaultix/mcp");
    expect(connections).toContain("vaultix mcp");
    expect(connections).toContain("panel MCP is not the connector");
    expect(connections).toContain("Grok bot");
    expect(connections).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
  });

  test("the main MCP lists every warp point and explains sign-in without credentials", () => {
    const read = (name: string) =>
      JSON.parse(
        (call("tools/call", { name, arguments: {} }) as { result: { content: { text: string }[] } }).result.content[0]
          .text
      ) as Record<string, unknown>;
    const warp = read("vaultix.warp.list") as {
      main: string;
      points: { domain: string; status: string; endpoint: string | null; tools: { name: string }[] }[];
    };
    expect(warp.main).toBe("/api/v1/vaultix/mcp");
    expect(warp.points.map((point) => point.domain)).toEqual([
      "public",
      "auth",
      "workspace",
      "secrets",
      "access",
      "automation",
      "connect",
      "pki",
      "kms",
      "pam",
      "detect",
      "ai",
      "governance",
      "operate",
      "experience"
    ]);
    for (const point of warp.points) {
      expect(point.endpoint).toBe(point.status === "live" ? `/api/vx/v1/${point.domain}/mcp` : null);
      expect(point.status === "live").toBe(point.tools.length > 0);
    }
    // Each tool belongs to exactly one domain.
    const owned = warp.points.flatMap((point) => point.tools.map((tool) => tool.name));
    expect(new Set(owned).size).toBe(owned.length);

    const options = read("vaultix.auth.options.get") as { options: { id: string; status: string }[] };
    expect(options.options.map((option) => [option.id, option.status])).toEqual([
      ["machine-identity", "available"],
      ["headless-cli", "available"],
      ["user-session", "not-available"]
    ]);
    const text = JSON.stringify(options);
    expect(text).toContain("vaultix login --universal");
    expect(text).toContain("vaultix login --token");
    expect(text).toContain("60 minutes");
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
  });

  test("a warp point surface lists and answers only its own guidance tools", () => {
    const surface = { serverName: "vaultix-auth", instructions: "Auth only.", guidance: ["vaultix.auth.options.get"] };
    const listed = handleVaultixMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, undefined, undefined, surface) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(["vaultix.auth.options.get"]);
    expect(
      handleVaultixMcp(
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vaultix.catalog.get", arguments: {} } },
        undefined,
        undefined,
        surface
      )
    ).toMatchObject({ error: { message: "Unknown Vaultix tool." } });
    expect(
      handleVaultixMcp(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", clientInfo: { name: "codex", version: "1" }, capabilities: {} }
        },
        undefined,
        undefined,
        surface
      )
    ).toMatchObject({ result: { serverInfo: { name: "vaultix-auth" }, instructions: "Auth only." } });
  });

  test("accepts protocol metadata independently of tool and pagination parameters", () => {
    const metadata = { progressToken: 7, "test.example/context": { value: "CANARY-METADATA" } };
    expect(call("tools/list", { _meta: metadata })).toEqual(call("tools/list"));
    const request = { name: "vaultix.catalog.get", arguments: {} };
    expect(call("tools/call", { ...request, _meta: metadata })).toEqual(call("tools/call", request));
    expect(call("tools/list", { _meta: metadata, cursor: "CANARY-CURSOR" })).toMatchObject({ error: { code: -32602 } });
    expect(call("tools/list", { _meta: metadata, value: "CANARY-SECRET" })).toMatchObject({ error: { code: -32602 } });
    expect(JSON.stringify(call("tools/list", { _meta: metadata }))).not.toContain("CANARY-METADATA");
  });

  test.each([null, [], 1, "CANARY-METADATA"])("rejects malformed request metadata %#", (_meta) => {
    for (const method of ["tools/list", "resources/list", "resources/read", "tools/call", "ping"]) {
      const response = call(method, { _meta });
      expect(response).toMatchObject({ error: { code: -32602 } });
      expect(JSON.stringify(response)).not.toContain("CANARY-METADATA");
    }
  });

  test("rejects supplied secrets and unknown tools without echoing values", () => {
    const response = call("tools/call", { name: "vaultix.catalog.get", arguments: { value: "CANARY-SECRET" } });
    expect(response).toMatchObject({ error: { code: -32602 } });
    expect(JSON.stringify(response)).not.toContain("CANARY-SECRET");
    expect(call("tools/call", { name: "CANARY-SECRET" })).toMatchObject({
      error: { message: "Unknown Vaultix tool." }
    });
  });

  test.each([null, [], {}, { jsonrpc: "1.0", method: "ping", id: 1 }, { jsonrpc: "2.0", method: "ping", id: {} }])(
    "rejects malformed requests %#",
    (body) => {
      expect(handleVaultixMcp(body)).toMatchObject({ error: { code: -32600 } });
    }
  );

  test("handles notifications, ping, and unknown methods", () => {
    expect(handleVaultixMcp({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(call("ping")).toMatchObject({ result: {} });
    expect(call("secret.read")).toMatchObject({ error: { code: -32601 } });
  });
});

describe("included Vaultix feature policy", () => {
  test("includes security controls without seat or project paywalls", () => {
    const plan = getVaultixFeatures();
    expect(plan).toMatchObject({
      secretApproval: true,
      secretRotation: true,
      auditLogs: true,
      dynamicSecret: true,
      oidcSSO: true,
      scim: true,
      rbac: true,
      memberLimit: null,
      workspaceLimit: null,
      identityLimit: null
    });
    expect(plan.auditLogsRetentionDays).toBeGreaterThan(0);
  });
  test("each request receives its own feature object", () => {
    const first = getVaultixFeatures();
    first.rateLimits.readLimit = 1;
    expect(getVaultixFeatures().rateLimits.readLimit).toBe(60);
  });
});
