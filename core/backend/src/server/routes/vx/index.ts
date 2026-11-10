import { registerProviderImportRouter } from "../v3/external-migration-router";
import type { TVaultixReferenceOptions } from "../vaultix-shared";
import { registerWarpPointRouter } from "./warp-point-router";

// The Vaultix API, /api/vx/v1/<domain>/…, grouped by the canonical interaction domains (docs/0119,
// docs/0120). Each domain mounts its own routers here as they move off the inherited prefixes;
// every domain's MCP warp point is /api/vx/v1/<domain>/mcp.
export const registerVxRoutes = async (server: FastifyZodProvider, options: { vaultix: TVaultixReferenceOptions }) => {
  await server.register(registerProviderImportRouter, { prefix: "/connect/imports" });
  await server.register(registerWarpPointRouter, options.vaultix);
};
