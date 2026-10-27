import fastify, { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";

import { UnauthorizedError } from "@app/lib/errors";

import { fastifyErrHandler } from "./error-handler";

vi.mock("@app/lib/config/env", () => ({
  getConfig: () => ({ OTEL_TELEMETRY_COLLECTION_ENABLED: false })
}));

const canary = "request-value-must-stay-private";
let app: FastifyInstance;
let logs: string[];
let handler: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  logs = [];
  app = fastify({ bodyLimit: 128, logger: { level: "warn", stream: { write: (entry: string) => logs.push(entry) } } });
  handler = vi.fn(() => ({ accepted: true }));
  await app.register(fastifyErrHandler);
  app.post("/request", handler);
  app.get("/unexpected", async () => {
    throw new Error(canary);
  });
  app.get("/forged-parser-error", async () => {
    throw Object.assign(new Error(canary), { code: "FST_ERR_CTP_INVALID_MEDIA_TYPE", statusCode: 415 });
  });
  app.get("/unauthorized", async () => {
    throw new UnauthorizedError({ message: "Sign in to continue" });
  });
  app.get("/expired", async () => {
    throw new jwt.TokenExpiredError("jwt expired", new Date(0));
  });
  app.post("/api/v1/cert-manager/certificates", async () => {
    throw new SyntaxError("Invalid CSR JSON");
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

test.each([
  {
    name: "unsupported media",
    contentType: "application/x-vaultix-invalid",
    payload: canary,
    status: 415,
    error: "UnsupportedMediaType"
  },
  {
    name: "malformed JSON",
    contentType: "application/json",
    payload: `{"name":"${canary}",`,
    status: 400,
    error: "InvalidJsonBody"
  },
  { name: "empty JSON", contentType: "application/json", payload: "", status: 400, error: "EmptyJsonBody" },
  {
    name: "oversized body",
    contentType: "application/json",
    payload: JSON.stringify({ name: canary.repeat(10) }),
    status: 413,
    error: "RequestBodyTooLarge"
  },
  {
    name: "incorrect content length",
    contentType: "application/json",
    payload: JSON.stringify({ name: canary }),
    length: "1",
    status: 400,
    error: "InvalidContentLength"
  },
  {
    name: "prototype poisoning",
    contentType: "application/json",
    payload: `{"__proto__":{"name":"${canary}"}}`,
    status: 400,
    error: "InvalidJsonBody"
  }
])("$name is a redacted client failure", async ({ contentType, payload, length, status, error }) => {
  const response = await app.inject({
    method: "POST",
    url: "/request",
    payload,
    headers: { "content-type": contentType, ...(length ? { "content-length": length } : {}) }
  });
  expect(response.statusCode).toBe(status);
  const body = response.json<{ statusCode: number; error: string; message: string }>();
  expect(body).toMatchObject({ statusCode: status, error });
  expect(typeof body.message).toBe("string");
  expect(response.body).not.toContain(canary);
  expect(logs.join("\n")).not.toContain(canary);
  expect(handler).not.toHaveBeenCalled();
});

test("valid JSON reaches the existing handler", async () => {
  const response = await app.inject({ method: "POST", url: "/request", payload: { name: canary } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ accepted: true });
  expect(handler).toHaveBeenCalledOnce();
});

test.each(["/unexpected", "/forged-parser-error"])("%s remains a redacted server error", async (url) => {
  const response = await app.inject(url);
  expect(response.statusCode).toBe(500);
  expect(response.json<{ error: string }>().error).toBe("InternalServerError");
  expect(response.body).not.toContain(canary);
});

test("existing authentication and certificate guidance are preserved", async () => {
  expect((await app.inject("/unauthorized")).statusCode).toBe(401);
  const expired = await app.inject("/expired");
  expect(expired.statusCode).toBe(403);
  expect(expired.json<{ error: string }>().error).toBe("TokenError");
  const certificate = await app.inject({ method: "POST", url: "/api/v1/cert-manager/certificates", payload: {} });
  expect(certificate.statusCode).toBe(400);
  expect(certificate.json<{ message: string }>().message).toContain("Certificate Signing Request");
});
