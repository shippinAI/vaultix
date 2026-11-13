import { generateKeyPairSync } from "node:crypto";
import { createServer, Socket } from "node:net";
import { createSecureContext, createServer as createTlsServer, TLSSocket } from "node:tls";

import forge from "node-forge";
import { expect, test, vi } from "vitest";

import { smtpServiceFactory } from "./smtp-service";

vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ SITE_URL: "https://vaultix.invalid", isCloud: false }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const deliveryId = "22222222-2222-4222-8222-222222222222";
const payload = {
  version: 1,
  recipient: "admin@vaultix.invalid",
  from: { name: "Vaultix", address: "security@vaultix.invalid" },
  subject: "Vaultix security notice",
  html: "<p>Device security event</p>",
  createdAt: "2026-10-31T00:00:00.000Z"
};
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const certificate = forge.pki.createCertificate();
certificate.publicKey = forge.pki.publicKeyFromPem(keys.publicKey.export({ type: "spki", format: "pem" }).toString());
certificate.serialNumber = "01";
certificate.validity.notBefore = new Date(Date.now() - 3600000);
certificate.validity.notAfter = new Date(Date.now() + 86400000);
certificate.setSubject([{ name: "commonName", value: "localhost" }]);
certificate.setIssuer(certificate.subject.attributes);
certificate.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] }]);
certificate.sign(forge.pki.privateKeyFromPem(key), forge.md.sha256.create());
const cert = forge.pki.certificateToPem(certificate);

type Mode = "accept" | "greeting-wait" | "data-wait" | "ehlo-drip";
const startSmtp = async (mode: Mode, tlsMode: "none" | "implicit" | "starttls" = "none") => {
  const sockets = new Set<Socket>();
  const intervals = new Set<NodeJS.Timeout>();
  let connections = 0;
  let messages = 0;
  let envelopes = 0;
  let nextMode = mode;
  const attach = (socket: Socket, secured = false, greeting = true) => {
    const connectionMode = nextMode;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    if (greeting && connectionMode !== "greeting-wait") socket.write("220 localhost ESMTP\r\n");
    let input = "";
    let readingData = false;
    const receive = (chunk: string) => {
      input += chunk;
      let end = input.indexOf("\r\n");
      while (end >= 0) {
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        if (readingData) {
          if (line === ".") {
            readingData = false;
            messages += 1;
            if (connectionMode !== "data-wait") socket.write("250 accepted\r\n");
          }
        } else if (/^(EHLO|HELO)/i.test(line)) {
          if (connectionMode === "ehlo-drip") {
            const interval = setInterval(() => socket.write("250-still preparing\r\n"), 100);
            intervals.add(interval);
            socket.once("close", () => clearInterval(interval));
          } else socket.write(tlsMode === "starttls" && !secured ? "250-localhost\r\n250 STARTTLS\r\n" : "250 OK\r\n");
        } else if (line === "STARTTLS" && tlsMode === "starttls" && !secured) {
          socket.removeListener("data", receive);
          socket.write("220 Ready for TLS\r\n");
          const upgraded = new TLSSocket(socket, { isServer: true, secureContext: createSecureContext({ key, cert }) });
          attach(upgraded, true, false);
          return;
        } else if (/^MAIL FROM/i.test(line)) {
          envelopes += 1;
          socket.write("250 OK\r\n");
        } else if (/^RCPT TO/i.test(line)) socket.write("250 OK\r\n");
        else if (line === "DATA") {
          readingData = true;
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("500 unsupported command\r\n");
        end = input.indexOf("\r\n");
      }
    };
    socket.on("data", receive);
  };
  const server =
    tlsMode === "implicit" ? createTlsServer({ key, cert }, (socket) => attach(socket, true)) : createServer(attach);
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing SMTP test port");
  return {
    config: {
      host: "127.0.0.1",
      port: address.port,
      secure: tlsMode === "implicit",
      requireTLS: tlsMode === "starttls",
      tls: { ca: cert, servername: "localhost" }
    },
    state: () => ({ connections, messages, envelopes, active: sockets.size }),
    setMode: (value: Mode) => {
      nextMode = value;
    },
    close: async () => {
      for (const interval of intervals) clearInterval(interval);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
};

test("pre-aborted attempt creates no SMTP connection", async () => {
  const smtp = await startSmtp("accept");
  try {
    await expect(
      smtpServiceFactory(smtp.config).sendPreparedRecordedMail(deliveryId, payload, AbortSignal.abort())
    ).rejects.toMatchObject({ disposition: "retryable" });
    expect(smtp.state()).toEqual({ connections: 0, messages: 0, envelopes: 0, active: 0 });
  } finally {
    await smtp.close();
  }
});

test.each(["greeting-wait", "data-wait"] as const)("abort closes the actual socket during %s", async (mode) => {
  const smtp = await startSmtp(mode);
  const controller = new AbortController();
  try {
    const outcome = smtpServiceFactory(smtp.config)
      .sendPreparedRecordedMail(deliveryId, payload, controller.signal)
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(mode === "data-wait" ? smtp.state().messages : smtp.state().connections).toBe(1));
    controller.abort(new Error("must-not-escape-cancellation-canary"));
    expect(await outcome).toMatchObject({ disposition: "uncertain" });
    expect(String(await outcome)).not.toContain("cancellation-canary");
    await vi.waitFor(() => expect(smtp.state().active).toBe(0));
    expect(smtp.state().connections).toBe(1);
    expect(smtp.state().messages).toBe(mode === "data-wait" ? 1 : 0);
  } finally {
    controller.abort();
    await smtp.close();
  }
});

test("total deadline closes SMTP despite continuous response activity", async () => {
  const smtp = await startSmtp("ehlo-drip");
  try {
    const started = Date.now();
    await expect(smtpServiceFactory(smtp.config).sendPreparedRecordedMail(deliveryId, payload)).rejects.toMatchObject({
      disposition: "uncertain"
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(29000);
    expect(Date.now() - started).toBeLessThan(40000);
    await vi.waitFor(() => expect(smtp.state().active).toBe(0));
    expect(smtp.state().connections).toBe(1);
    expect(smtp.state().messages).toBe(0);
  } finally {
    await smtp.close();
  }
}, 45000);

test("canceling one attempt leaves another attempt on the same service independent", async () => {
  const smtp = await startSmtp("data-wait");
  const controller = new AbortController();
  try {
    const service = smtpServiceFactory(smtp.config);
    const first = service
      .sendPreparedRecordedMail(deliveryId, payload, controller.signal)
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(smtp.state().messages).toBe(1));
    smtp.setMode("accept");
    expect(await service.sendPreparedRecordedMail("33333333-3333-4333-8333-333333333333", payload)).toBe("accepted");
    controller.abort();
    expect(await first).toMatchObject({ disposition: "uncertain" });
    await vi.waitFor(() => expect(smtp.state().active).toBe(0));
    expect(smtp.state().messages).toBe(2);
  } finally {
    controller.abort();
    await smtp.close();
  }
});

test.each(["implicit", "starttls"] as const)(
  "%s preserves certificate validation and cancels the wrapped socket",
  async (tlsMode) => {
    const smtp = await startSmtp("accept", tlsMode);
    const controller = new AbortController();
    try {
      expect(await smtpServiceFactory(smtp.config).sendPreparedRecordedMail(deliveryId, payload)).toBe("accepted");
      for (const tls of [{ servername: "localhost" }, { ca: cert, servername: "wrong.vaultix.invalid" }]) {
        // eslint-disable-next-line no-await-in-loop
        await expect(
          smtpServiceFactory({ ...smtp.config, tls }).sendPreparedRecordedMail(deliveryId, payload)
        ).rejects.toThrow();
      }
      expect(smtp.state().messages).toBe(1);
      smtp.setMode("data-wait");
      const waiting = smtpServiceFactory(smtp.config)
        .sendPreparedRecordedMail(deliveryId, payload, controller.signal)
        .catch((error: unknown) => error);
      await vi.waitFor(() => expect(smtp.state().messages).toBe(2));
      controller.abort();
      expect(await waiting).toMatchObject({ disposition: "uncertain" });
      await vi.waitFor(() => expect(smtp.state().active).toBe(0));
      expect(smtp.state().connections).toBe(4);
    } finally {
      controller.abort();
      await smtp.close();
    }
  },
  15000
);

test("required STARTTLS never falls back to plaintext delivery", async () => {
  const smtp = await startSmtp("accept");
  try {
    await expect(
      smtpServiceFactory({ ...smtp.config, requireTLS: true }).sendPreparedRecordedMail(deliveryId, payload)
    ).rejects.toMatchObject({ disposition: "retryable" });
    expect(smtp.state().envelopes).toBe(0);
    expect(smtp.state().messages).toBe(0);
  } finally {
    await smtp.close();
  }
});
