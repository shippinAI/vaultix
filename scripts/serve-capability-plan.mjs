import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { capabilities } from "../docs/capabilities/catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedReferences = new Set(capabilities.flatMap((item) => item.references));
const routes = new Map([
  ["/", ["docs/capabilities/explorer.html", "text/html"]],
  ["/explorer.css", ["docs/capabilities/explorer.css", "text/css"]],
  ["/explorer.mjs", ["docs/capabilities/explorer.mjs", "text/javascript"]],
  ["/catalog.json", ["docs/capabilities/generated/catalog.json", "application/json"]],
  [
    "/surface-map.tsv",
    ["docs/capabilities/generated/surface-map.tsv", "text/tab-separated-values"],
  ],
  ["/source-map.tsv", ["docs/capabilities/generated/source-map.tsv", "text/tab-separated-values"]],
  ["/plan.md", ["docs/0049-capability-product-plan.md", "text/plain"]],
]);
export function createPlanServer() {
  return createServer(async (request, response) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    // Reject browser DNS rebinding; only this loopback origin may retrieve files.
    if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? "")) {
      response.writeHead(403).end("Loopback host required");
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      response.writeHead(405).end("Read-only planning server");
      return;
    }
    let url;
    try {
      url = new URL(request.url, "http://127.0.0.1");
    } catch {
      response.writeHead(400).end("Invalid request");
      return;
    }
    let route = routes.get(url.pathname);
    if (url.pathname === "/reference" && allowedReferences.has(url.searchParams.get("path")))
      route = [url.searchParams.get("path"), "text/plain"];
    if (!route) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const content = await readFile(resolve(root, route[0]));
      response.setHeader("Content-Type", `${route[1]}; charset=utf-8`);
      response.writeHead(200).end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(503).end("Planning artifact unavailable; regenerate the capability map");
    }
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = createPlanServer();
  server.on("error", (error) => {
    console.error(`Planning server failed: ${error.code ?? "unknown error"}`);
    process.exitCode = 1;
  });
  server.listen(4310, "127.0.0.1", () =>
    console.log("Vaultix capability plan: http://127.0.0.1:4310 (read only)"),
  );
}
