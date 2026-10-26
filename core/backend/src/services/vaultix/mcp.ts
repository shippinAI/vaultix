import { readVaultixTool, specialistInstructions, vaultixTools } from "./catalog";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const handleVaultixMcp = (
  body: unknown,
  actions?: {
    tools: unknown[];
    names: string[];
    call: (name: string, args: unknown) => Promise<unknown>;
  }
) => {
  const validId =
    isRecord(body) &&
    ((typeof body.id === "string" && body.id.length <= 128) ||
      (typeof body.id === "number" && Number.isSafeInteger(body.id)));
  const id = validId ? body.id : null;
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string" || body.method.length > 128) {
    return error(-32600, "Invalid JSON-RPC request.");
  }
  if (body.id === undefined) {
    return body.method.startsWith("notifications/") ? undefined : error(-32600, "A request ID is required.");
  }
  if (!validId) return error(-32600, "Invalid request ID.");
  if (body.params !== undefined && !isRecord(body.params)) return error(-32602, "Parameters must be an object.");
  const params = body.params ?? {};
  const result = (value: unknown) => ({ jsonrpc: "2.0", id, result: value });
  switch (body.method) {
    case "initialize":
      if (
        typeof params.protocolVersion !== "string" ||
        !isRecord(params.clientInfo) ||
        !isRecord(params.capabilities)
      ) {
        return error(-32602, "Initialization requires protocolVersion, clientInfo, and capabilities.");
      }
      return result({
        protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(params.protocolVersion)
          ? params.protocolVersion
          : "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "vaultix-clyffy", version: "1.0.0" },
        instructions: specialistInstructions
      });
    case "ping":
      return result({});
    case "tools/list":
      if (Object.keys(params).length) return error(-32602, "This tool list has no pagination parameters.");
      return result({ tools: [...vaultixTools, ...(actions?.tools ?? [])] });
    case "tools/call": {
      if (
        typeof params.name !== "string" ||
        params.name.length > 128 ||
        Object.keys(params).some((key) => !["name", "arguments", "_meta"].includes(key))
      ) {
        return error(-32602, "Specify a Vaultix tool name and empty arguments.");
      }
      if (actions?.names.includes(params.name)) {
        const value = actions.call(params.name, params.arguments ?? {});
        return value.then((data) =>
          result({ content: [{ type: "text", text: JSON.stringify(data) }], isError: false })
        );
      }
      if (params.arguments !== undefined && (!isRecord(params.arguments) || Object.keys(params.arguments).length)) {
        return error(-32602, "Vaultix guidance tools accept no arguments or secret values.");
      }
      const value = readVaultixTool(params.name);
      if (value === undefined) return error(-32602, "Unknown Vaultix tool.");
      return result({ content: [{ type: "text", text: JSON.stringify(value) }], isError: false });
    }
    default:
      return error(-32601, "Method not found.");
  }
};
