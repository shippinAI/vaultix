import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const mcpAppMimeType = "text/html;profile=mcp-app";
export const mcpAppExtension = "io.modelcontextprotocol/ui";
export type McpAppResource = { uri: string; text: string };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const requestsMcpApp = (body: unknown) => {
  if (!record(body) || body.method !== "initialize" || !record(body.params)) return false;
  const { capabilities } = body.params;
  if (!record(capabilities) || !record(capabilities.extensions)) return false;
  const extension = capabilities.extensions[mcpAppExtension];
  return record(extension) && Array.isArray(extension.mimeTypes) && extension.mimeTypes.includes(mcpAppMimeType);
};

// The path is deployment-owned, never derived from a requested resource URI.
export const loadMcpAppResource = async (): Promise<McpAppResource | undefined> => {
  try {
    const directory = resolve("frontend-build/mcp-apps");
    const manifestText = await readFile(resolve(directory, "manifest.json"), "utf8");
    if (Buffer.byteLength(manifestText) > 2048) return undefined;
    const manifest: unknown = JSON.parse(manifestText);
    if (!record(manifest) || manifest.schemaVersion !== "vaultix.mcp-app.v1") return undefined;
    const text = await readFile(resolve(directory, "references.html"), "utf8");
    const bytes = Buffer.byteLength(text);
    const hash = createHash("sha256").update(text).digest("hex");
    if (
      bytes > 1024 * 1024 ||
      bytes !== manifest.bytes ||
      hash !== manifest.sha256 ||
      manifest.uri !== `ui://vaultix/references/v1/${hash}.html`
    )
      return undefined;
    return { uri: manifest.uri, text };
  } catch {
    // Development/API-only installations retain the complete text tool contract.
    return undefined;
  }
};

export const describeMcpAppResource = (resource: McpAppResource) => ({
  uri: resource.uri,
  name: "vaultix-references",
  description: "Browse authorized secret references with contextual help. Secret values stay in Vaultix.",
  mimeType: mcpAppMimeType,
  _meta: {
    ui: {
      prefersBorder: true,
      csp: {
        connectDomains: [],
        resourceDomains: [],
        frameDomains: [],
        baseUriDomains: []
      }
    }
  }
});
