import { registerProviderImportRouter } from "../v3/external-migration-router";

// The Vaultix API, /api/vx/v1/<domain>/…, grouped by MCPL domain (docs/0119).
// Each domain mounts its own routers here as they move off the inherited prefixes.
export const registerVxRoutes = async (server: FastifyZodProvider) => {
  await server.register(registerProviderImportRouter, { prefix: "/connect/imports" });
};
