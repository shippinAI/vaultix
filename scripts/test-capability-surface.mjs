import assert from "node:assert/strict";
import { apiOperations, missingSurface, uiRoutes } from "./check-capability-surface.mjs";

const baseline = { schemaVersion: 1, uiRoutes: ["/", "/login", "/projects"], apiOperations: ["GET /projects", "POST /projects"] };
assert.deepEqual(missingSurface(baseline, { uiRoutes: ["/", "/login"], apiOperations: ["GET /projects", "PATCH /projects"] }), {
  uiRoutes: ["/projects"], apiOperations: ["POST /projects"]
});
assert.deepEqual(missingSurface(baseline, { uiRoutes: [...baseline.uiRoutes, "/help"], apiOperations: [...baseline.apiOperations, "GET /health"] }), {
  uiRoutes: [], apiOperations: []
});
assert.throws(() => missingSurface({ ...baseline, apiOperations: [] }, {}), /Empty baseline/);
assert.throws(() => apiOperations({ paths: {} }), /Vaultix OpenAPI/);
assert.throws(() => uiRoutes("export interface SomethingElse {}"), /interface is missing/);
assert.deepEqual(uiRoutes("export interface FileRoutesByFullPath {\n  '/': typeof root\n  '/login': typeof login\n  '/projects/$id': typeof project\n}\n"), ["/", "/login", "/projects/$id"]);
assert.deepEqual(apiOperations({ info: { title: "Vaultix API" }, paths: { "/projects": { get: {}, post: {}, parameters: [], summary: "Projects" } } }), ["GET /projects", "POST /projects"]);
console.log("Capability surface gate rejects removed paths/methods and malformed input; additive routes remain allowed.");
