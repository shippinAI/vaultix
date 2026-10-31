import { createServer, Socket } from "node:net";

import { afterEach, expect, test, vi } from "vitest";

import { smtpServiceFactory, SmtpTemplates } from "./smtp-service";

const config = vi.hoisted(() => ({ SITE_URL: "https://original.vaultix.invalid", isCloud: false }));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => config }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Mode = "accept" | "reject-recipient" | "reject-data" | "lose-acknowledgment";
const startSmtp = async () => {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const recipients: string[] = [];
  const senders: string[] = [];
  let mode: Mode = "accept";
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let input = "";
    let message = "";
    let readingData = false;
    socket.setEncoding("utf8");
    socket.write("220 vaultix.invalid ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      input += chunk;
      let end = input.indexOf("\r\n");
      while (end >= 0) {
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        if (readingData) {
          if (line === ".") {
            messages.push(message);
            readingData = false;
            message = "";
            if (mode === "lose-acknowledgment") socket.destroy();
            else socket.write(mode === "reject-data" ? "554 message rejected\r\n" : "250 accepted\r\n");
          } else message += `${line}\n`;
        } else if (/^(EHLO|HELO|RSET)/i.test(line)) socket.write("250 OK\r\n");
        else if (/^MAIL FROM/i.test(line)) {
          senders.push(line);
          socket.write("250 OK\r\n");
        } else if (/^RCPT TO/i.test(line)) {
          recipients.push(line);
          socket.write(mode === "reject-recipient" ? "550 recipient rejected\r\n" : "250 OK\r\n");
        } else if (line === "DATA") {
          readingData = true;
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("500 unsupported command\r\n");
        end = input.indexOf("\r\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected local SMTP port");
  return {
    settings: {
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      ignoreTLS: true,
      from: "Vaultix <security@vaultix.invalid>"
    },
    messages,
    recipients,
    senders,
    connectionCount: () => connections,
    setMode: (value: Mode) => {
      mode = value;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
};

const deliveryId = "22222222-2222-4222-8222-222222222222";
const preparation = {
  recipient: "admin@vaultix.invalid",
  template: SmtpTemplates.OrgAdminBreakglassAccess,
  subjectLine: "Vaultix security alert",
  createdAt: new Date("2026-10-31T00:00:00.000Z"),
  substitutions: {
    email: "owner@vaultix.invalid",
    timestamp: "2026-10-31T00:00:00Z",
    ip: "192.0.2.5",
    userAgent: "Vaultix verification",
    orgId: "33333333-3333-4333-8333-333333333333"
  }
};

afterEach(() => {
  config.SITE_URL = "https://original.vaultix.invalid";
  config.isCloud = false;
});

test("real renderer and SMTP replay the same serialized notice after configuration and sender change", async () => {
  const smtp = await startSmtp();
  try {
    const service = smtpServiceFactory(smtp.settings);
    const prepared = await service.prepareRecordedMail(preparation);
    expect(prepared?.html).toContain(
      "https://original.vaultix.invalid/organizations/33333333-3333-4333-8333-333333333333/settings"
    );
    expect(await service.sendPreparedRecordedMail(deliveryId, prepared)).toBe("accepted");
    config.SITE_URL = "https://changed.vaultix.invalid";
    config.isCloud = true;
    const restarted = smtpServiceFactory({ ...smtp.settings, from: "changed@vaultix.invalid" });
    expect(await restarted.sendPreparedRecordedMail(deliveryId, JSON.parse(JSON.stringify(prepared)))).toBe("accepted");
    expect(smtp.messages).toHaveLength(2);
    expect(smtp.messages[1]).toBe(smtp.messages[0]);
    expect(smtp.messages[0]).toContain("Message-ID: <22222222-2222-4222-8222-222222222222@vaultix.cloud>");
    expect(smtp.messages[0]).toContain("Date: Sat, 31 Oct 2026 00:00:00 +0000");
    expect(smtp.messages[0]).not.toContain("changed.vaultix.invalid");
    expect(smtp.senders).toEqual(["MAIL FROM:<security@vaultix.invalid>", "MAIL FROM:<security@vaultix.invalid>"]);
    expect(smtp.recipients).toEqual(["RCPT TO:<admin@vaultix.invalid>", "RCPT TO:<admin@vaultix.invalid>"]);
  } finally {
    await smtp.close();
  }
}, 30000);

test("real SMTP rejection can retry while lost post-DATA acknowledgment remains uncertain", async () => {
  const smtp = await startSmtp();
  try {
    const service = smtpServiceFactory(smtp.settings);
    const prepared = await service.prepareRecordedMail(preparation);
    smtp.setMode("reject-recipient");
    await expect(service.sendPreparedRecordedMail(deliveryId, prepared)).rejects.toMatchObject({
      disposition: "retryable"
    });
    expect(smtp.messages).toHaveLength(0);
    smtp.setMode("reject-data");
    await expect(service.sendPreparedRecordedMail(deliveryId, prepared)).rejects.toMatchObject({
      disposition: "retryable"
    });
    expect(smtp.messages).toHaveLength(1);
    smtp.setMode("lose-acknowledgment");
    await expect(service.sendPreparedRecordedMail(deliveryId, prepared)).rejects.toMatchObject({
      disposition: "uncertain"
    });
    expect(smtp.messages).toHaveLength(2);
    expect(smtp.connectionCount()).toBe(3);
    // The transport must not silently retry an ambiguous transmission itself.
    expect(smtp.messages[1]).toBe(smtp.messages[0]);
  } finally {
    await smtp.close();
  }
}, 30000);

test("disabled and invalid prepared deliveries never open an SMTP connection", async () => {
  const smtp = await startSmtp();
  try {
    const service = smtpServiceFactory(smtp.settings);
    const prepared = await service.prepareRecordedMail(preparation);
    expect(await smtpServiceFactory({}).sendPreparedRecordedMail(deliveryId, prepared)).toBe("disabled");
    await expect(
      service.sendPreparedRecordedMail(deliveryId, { ...prepared, attachments: [{ path: "/tmp/private-canary" }] })
    ).rejects.toMatchObject({ disposition: "invalid" });
    await expect(
      service.sendPreparedRecordedMail(deliveryId, { ...prepared, recipient: "a@vaultix.invalid,b@vaultix.invalid" })
    ).rejects.toMatchObject({ disposition: "invalid" });
    expect(smtp.connectionCount()).toBe(0);
    expect(smtp.messages).toHaveLength(0);
  } finally {
    await smtp.close();
  }
}, 30000);

test("real new-device template captures escaped session context and sends its prepared notice", async () => {
  const smtp = await startSmtp();
  try {
    const service = smtpServiceFactory(smtp.settings);
    const prepared = await service.prepareRecordedMail({
      ...preparation,
      template: SmtpTemplates.NewDeviceJoin,
      subjectLine: "Vaultix new device login",
      substitutions: { ...preparation.substitutions, userAgent: "<script>unsafe-client-label</script>" }
    });
    expect(prepared?.html).toContain("&lt;script&gt;unsafe-client-label&lt;/script&gt;");
    expect(prepared?.html).not.toContain("<script>");
    expect(prepared?.html).toContain("owner@vaultix.invalid");
    expect(await service.sendPreparedRecordedMail(deliveryId, prepared)).toBe("accepted");
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]).toContain("Subject: Vaultix new device login");
  } finally {
    await smtp.close();
  }
}, 30000);
