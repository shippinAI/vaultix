import type { IncomingHttpHeaders } from "node:http";

const replacedHeaders = new Set([
  "cf-connecting-ip",
  "cf-pseudo-ipv4",
  "x-client-ip",
  "x-envoy-external-address",
  "x-forwarded-for",
  "fastly-client-ip",
  "true-client-ip",
  "x-real-ip",
  "x-cluser-client-ip",
  "forwarded-for",
  "x-forwarded",
  "forwarded",
  "x-appengine-user-ip",
  "x-request-id"
]);

// The internal Go hop receives the address already resolved by the API boundary.
// Normalize casing before replacement so HTTP clients cannot merge forged and owned values.
export const sidecarRequestHeaders = (
  headers: IncomingHttpHeaders,
  requestId: string,
  realIp: string
): IncomingHttpHeaders => ({
  ...Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => !replacedHeaders.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), value])
  ),
  "x-request-id": requestId,
  "x-real-ip": realIp,
  "x-forwarded-for": realIp
});
