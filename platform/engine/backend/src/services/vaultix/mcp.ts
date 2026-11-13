import { readVaultixTool, specialistInstructions, vaultixTools } from "./catalog";
import { parseLearningContext } from "./learning-input";
import { describeMcpAppResource, mcpAppExtension, mcpAppMimeType, McpAppResource } from "./mcp-app-resource";
import { MAIN_MCP_TOOLS, viewForTool } from "./warp-points";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Which MCP this is: the main MCP or one warp point (docs/0120). It names the server, gives its
// instructions, and limits the guidance tools it lists and answers. Domain actions come in
// separately with their own handlers.
export type TMcpSurface = {
  serverName: string;
  instructions: string;
  guidance: ReadonlyArray<string>;
};

export const mainMcpSurface: TMcpSurface = {
  serverName: "vaultix-clyffy",
  instructions: specialistInstructions,
  guidance: vaultixTools.map((tool) => tool.name).filter((name) => MAIN_MCP_TOOLS.includes(name))
};

export const handleVaultixMcp = (
  body: unknown,
  actions?: {
    tools: unknown[];
    names: string[];
    call: (name: string, args: unknown) => Promise<unknown>;
  },
  // The packaged views this client negotiated. A tool is given one only when the registry
  // (warp-points.ts) declares that view for it and the view is loaded.
  views: ReadonlyArray<McpAppResource> = [],
  surface: TMcpSurface = mainMcpSurface
) => {
  const viewOf = (tool: unknown) => {
    if (!isRecord(tool) || typeof tool.name !== "string") return undefined;
    const declared = viewForTool(tool.name);
    return declared ? views.find((entry) => entry.view === declared) : undefined;
  };
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
  const { _meta: metadata, ...params } = body.params ?? {};
  if (metadata !== undefined && !isRecord(metadata)) return error(-32602, "Request metadata must be an object.");
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
        protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].includes(params.protocolVersion)
          ? params.protocolVersion
          : "2025-03-26",
        capabilities: {
          tools: { listChanged: false },
          ...(views.length
            ? {
                resources: { subscribe: false, listChanged: false },
                extensions: { [mcpAppExtension]: { mimeTypes: [mcpAppMimeType] } }
              }
            : {})
        },
        serverInfo: { name: surface.serverName, version: "1.0.0" },
        instructions: surface.instructions
      });
    case "ping":
      return result({});
    case "tools/list":
      if (Object.keys(params).length) return error(-32602, "This tool list has no pagination parameters.");
      return result({
        tools: [
          ...vaultixTools.filter((tool) => surface.guidance.includes(tool.name)),
          ...(actions?.tools ?? []).map((tool) => {
            const view = viewOf(tool);
            return view && isRecord(tool)
              ? { ...tool, _meta: { ui: { resourceUri: view.uri, visibility: ["model", "app"] } } }
              : tool;
          })
        ]
      });
    case "resources/list":
      if (!views.length) return error(-32601, "Method not found.");
      if (Object.keys(params).length) return error(-32602, "This resource list has no pagination parameters.");
      return result({ resources: views.map(describeMcpAppResource) });
    case "resources/read": {
      if (!views.length) return error(-32601, "Method not found.");
      const view = Object.keys(params).length === 1 ? views.find((entry) => entry.uri === params.uri) : undefined;
      if (!view) return error(-32602, "Unknown Vaultix resource.");
      return result({ contents: [{ ...describeMcpAppResource(view), text: view.text }] });
    }
    case "tools/call": {
      if (
        typeof params.name !== "string" ||
        params.name.length > 128 ||
        Object.keys(params).some((key) => !["name", "arguments"].includes(key))
      ) {
        return error(-32602, "Specify a Vaultix tool name and empty arguments.");
      }
      if (actions?.names.includes(params.name)) {
        const value = actions.call(params.name, params.arguments ?? {});
        return value.then((data) =>
          result({ content: [{ type: "text", text: JSON.stringify(data) }], isError: false })
        );
      }
      if (!surface.guidance.includes(params.name)) return error(-32602, "Unknown Vaultix tool.");
      if (params.name === "vaultix.learning.profile.get") {
        const context = parseLearningContext(params.arguments === undefined ? {} : params.arguments);
        if (!context) {
          return error(
            -32602,
            "Use supported context names and a whole interaction count from 0 to 1000000. Never send secret values."
          );
        }
        const value = readVaultixTool(params.name, context);
        if (value === undefined) return error(-32602, "Unknown Vaultix tool.");
        return result({ content: [{ type: "text", text: JSON.stringify(value) }], isError: false });
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
