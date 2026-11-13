import fp from "fastify-plugin";

// Identify all existing API versions without changing their paths or authorization.
export const vaultixProductIdentity = fp(async (server) => {
  server.addHook("onSend", async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith("/api/")) {
      void reply.header("X-Vaultix-Product", "Vaultix");
      void reply.header("X-Vaultix-Feature-Policy", "included");
    }
    return payload;
  });
});
