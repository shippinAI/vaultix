import { createHash, randomBytes } from "node:crypto";

type Cache = {
  get: (key: string) => Promise<string | null>;
  eval: (script: string, numberOfKeys: number, ...args: (string | number)[]) => Promise<unknown>;
  del: (key: string) => Promise<number>;
};
export type McpSessionBinding = {
  authMode: string;
  actor: string;
  actorId: string;
  orgId: string;
  authMethod: string | null;
};
export type McpSession = { version: 1; protocol: string; expiresAt: number };
export class McpSessionError extends Error {
  constructor(public statusCode: 400 | 404 | 429 | 503) {
    super("Vaultix MCP session unavailable.");
    this.name = "McpSessionError";
  }
}
const ttlSeconds = 4 * 60 * 60;
const issueScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= 8 then return 0 end
redis.call('INCR', KEYS[1])
if count == 0 then redis.call('EXPIRE', KEYS[1], 3600) end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return 1`;

export const createMcpSessionService = (cache: Cache, now = Date.now) => {
  const prefix = (binding: McpSessionBinding) => {
    const hash = createHash("sha256")
      .update(JSON.stringify([binding.authMode, binding.actor, binding.actorId, binding.orgId, binding.authMethod]))
      .digest("hex");
    // Both keys share a Redis Cluster hash slot. No token or actor identifiers are stored.
    return `vaultix:mcp:v1:{${hash}}`;
  };
  const key = (binding: McpSessionBinding, id: string) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new McpSessionError(404);
    return `${prefix(binding)}:session:${id}`;
  };
  return {
    async create(binding: McpSessionBinding, protocol: string) {
      const id = randomBytes(32).toString("hex");
      const session: McpSession = { version: 1, protocol, expiresAt: now() + ttlSeconds * 1000 };
      let issued: unknown;
      try {
        issued = await cache.eval(
          issueScript,
          2,
          `${prefix(binding)}:issuance`,
          key(binding, id),
          JSON.stringify(session),
          ttlSeconds
        );
      } catch {
        throw new McpSessionError(503);
      }
      if (issued === 0) throw new McpSessionError(429);
      if (issued !== 1) throw new McpSessionError(503);
      return id;
    },
    async read(binding: McpSessionBinding, id: string, protocol: unknown): Promise<McpSession> {
      const sessionKey = key(binding, id);
      let raw: string | null;
      try {
        raw = await cache.get(sessionKey);
      } catch {
        throw new McpSessionError(503);
      }
      if (!raw || raw.length > 512) throw new McpSessionError(404);
      let value: McpSession;
      try {
        value = JSON.parse(raw) as McpSession;
      } catch {
        throw new McpSessionError(404);
      }
      if (
        !value ||
        value.version !== 1 ||
        typeof value.protocol !== "string" ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= now()
      )
        throw new McpSessionError(404);
      if (protocol !== value.protocol) throw new McpSessionError(400);
      return value;
    },
    async remove(binding: McpSessionBinding, id: string) {
      const sessionKey = key(binding, id);
      try {
        await cache.del(sessionKey);
      } catch {
        throw new McpSessionError(503);
      }
    }
  };
};
