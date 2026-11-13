import { request } from "node:http";
import { performance } from "node:perf_hooks";

import fastify, { FastifyInstance } from "fastify";

import { fastifyErrHandler } from "./error-handler";

vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ OTEL_TELEMETRY_COLLECTION_ENABLED: false }) }));

let app: FastifyInstance;
let origin: string;

beforeEach(async () => {
  app = fastify({ bodyLimit: 128 });
  await app.register(fastifyErrHandler);
  app.post("/body", async () => ({ accepted: true }));
  app.get("/health", async () => ({ ok: true }));
  origin = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  await app.close();
});

const eagerUpload = (body: string) =>
  new Promise<{ status: number | undefined; error: string; connection: string | undefined }>((resolve, reject) => {
    const req = request(
      `${origin}/body`,
      {
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
      },
      (res) => {
        let response = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          response += chunk;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            error: (JSON.parse(response) as { error: string }).error,
            connection: res.headers.connection
          })
        );
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end(body);
  });

test("responds to eagerly sent oversized bodies without resetting clients", async () => {
  const body = JSON.stringify({ data: "x".repeat(200_000) });
  const results = await Promise.all(Array.from({ length: 12 }, () => eagerUpload(body)));
  expect(results).toEqual(
    Array.from({ length: 12 }, () => ({ status: 413, error: "RequestBodyTooLarge", connection: "close" }))
  );
});

test("responds within a bounded time when an oversized upload stalls", async () => {
  const start = performance.now();
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${origin}/body`,
      {
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json", "content-length": 200_000 }
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.flushHeaders();
  });
  expect(status).toBe(413);
  expect(performance.now() - start).toBeLessThan(2000);
});

test("allows a short eager upload to finish before closing its 413 response", async () => {
  const body = JSON.stringify({ data: "x".repeat(200_000) });
  const result = await new Promise<{ status: number | undefined; uploadFinished: boolean }>((resolve, reject) => {
    let uploadFinished = false;
    const req = request(
      `${origin}/body`,
      {
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
      },
      (res) => {
        const finishedBeforeResponse = uploadFinished;
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode, uploadFinished: finishedBeforeResponse }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body.slice(0, 32));
    setTimeout(() => {
      uploadFinished = true;
      req.end(body.slice(32));
    }, 20);
  });
  expect(result).toEqual({ status: 413, uploadFinished: true });
});

test("an aborted oversized upload does not prevent subsequent requests", async () => {
  await new Promise<void>((resolve) => {
    const req = request(`${origin}/body`, {
      method: "POST",
      agent: false,
      headers: { "content-type": "application/json", "content-length": 200_000 }
    });
    req.on("error", () => resolve());
    req.on("socket", (socket) => {
      socket.once("connect", () => {
        req.write("{");
        setTimeout(() => req.destroy(), 10);
      });
    });
  });
  const response = await fetch(`${origin}/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
