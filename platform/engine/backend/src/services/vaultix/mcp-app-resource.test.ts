import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { loadMcpAppResource, requestsMcpApp } from "./mcp-app-resource";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const text = '<!doctype html><html lang="en"><title>Vaultix References</title></html>';
const hash = createHash("sha256").update(text).digest("hex");
const manifest = {
  schemaVersion: "vaultix.mcp-app.v1",
  uri: `ui://vaultix/references/v1/${hash}.html`,
  sha256: hash,
  bytes: Buffer.byteLength(text)
};
describe("owned MCP resource loading", () => {
  beforeEach(() => vi.resetAllMocks());
  test("accepts only the exact digest-addressed deployment artifact", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(manifest)).mockResolvedValueOnce(text);
    await expect(loadMcpAppResource()).resolves.toEqual({ view: "references", uri: manifest.uri, text });
    expect(vi.mocked(readFile).mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(/frontend-build[/\\]mcp-apps[/\\]manifest\.json$/),
      expect.stringMatching(/frontend-build[/\\]mcp-apps[/\\]references\.html$/)
    ]);
  });
  test.each([
    { ...manifest, sha256: "b".repeat(64) },
    { ...manifest, uri: "file:///CANARY" },
    { ...manifest, bytes: 0 },
    { ...manifest, schemaVersion: "unknown" }
  ])("rejects mismatched manifests %#", async (value) => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(value)).mockResolvedValueOnce(text);
    await expect(loadMcpAppResource()).resolves.toBeUndefined();
  });
  test("missing and oversized artifacts retain text fallback", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error("Missing asset"));
    await expect(loadMcpAppResource()).resolves.toBeUndefined();
    vi.mocked(readFile)
      .mockResolvedValueOnce(JSON.stringify(manifest))
      .mockResolvedValueOnce("x".repeat(1024 * 1024 + 1));
    await expect(loadMcpAppResource()).resolves.toBeUndefined();
  });
  test("only an explicit initialize extension negotiates an app", () => {
    const params = {
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }
    };
    expect(requestsMcpApp({ method: "initialize", params })).toBe(true);
    expect(requestsMcpApp({ method: "tools/list", params })).toBe(false);
    expect(requestsMcpApp({ method: "initialize", params: { capabilities: { experimental: { ui: true } } } })).toBe(
      false
    );
  });
});
