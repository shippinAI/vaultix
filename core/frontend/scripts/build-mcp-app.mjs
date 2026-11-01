import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const result = await build({
  configFile: false,
  publicDir: false,
  resolve: { alias: { "@app": resolve("src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    write: false,
    minify: true,
    cssCodeSplit: false,
    lib: { entry: resolve("src/mcp-app/main.tsx"), formats: ["iife"], name: "VaultixReferences" },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});
const bundles = (Array.isArray(result) ? result : [result]).flatMap((value) => value.output);
const chunks = bundles.filter((value) => value.type === "chunk"),
  styles = bundles.filter((value) => value.type === "asset" && value.fileName.endsWith(".css"));
assert.equal(chunks.length, 1, "MCP view must have one self-contained script");
assert.equal(styles.length, 1, "MCP view must have one stylesheet");
assert.equal(bundles.length, 2, "MCP view cannot depend on separate assets");
assert.ok(!Object.keys(chunks[0].modules).some(path => /\/src\/(config\/request|context\/Auth|pages\/)/.test(path.replaceAll("\\", "/"))),
  "MCP view must not include application networking, credentials or route modules");
const script = chunks[0].code.replaceAll("</script", "<\\/script"),
  css = String(styles[0].source).replaceAll("</style", "<\\/style");
assert.ok(!/url\(/i.test(css), "MCP view cannot load fonts or external CSS resources");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vaultix References</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
assert.ok(Buffer.byteLength(html) <= 1024 * 1024, "MCP view exceeded its 1 MiB artifact budget");
const sha256 = createHash("sha256").update(html).digest("hex");
const directory = resolve("dist/mcp-apps");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "references.html"), html);
writeFileSync(
  resolve(directory, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: "vaultix.mcp-app.v1",
      uri: `ui://vaultix/references/v1/${sha256}.html`,
      sha256,
      bytes: Buffer.byteLength(html)
    },
    null,
    2
  )
);
console.log(
  JSON.stringify({ resource: "vaultix-references", bytes: Buffer.byteLength(html), sha256 })
);
