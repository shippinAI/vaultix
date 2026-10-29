import fp from "fastify-plugin";

// Historical request-ip attribution retained from the replaced header-selection implementation.
/*! https://github.com/pbojinov/request-ip/blob/9501cdf6e73059cc70fc6890adb086348d7cca46/src/index.js.
  MIT License. 2022 Petar Bojinov - petarbojinov+github@gmail.com */
export const resolveProxyTrust = (trustedProxyCidrs?: string): string | false => trustedProxyCidrs?.trim() || false;

export const fastifyIp = fp(async (fastify) => {
  fastify.decorateRequest("realIp");
  fastify.addHook("onRequest", async (req) => {
    // One source for authorization, audit and rate limits. Fastify validates the socket
    // peer and walks X-Forwarded-For only through explicitly trusted proxy addresses.
    req.realIp = req.ip;
  });
});
