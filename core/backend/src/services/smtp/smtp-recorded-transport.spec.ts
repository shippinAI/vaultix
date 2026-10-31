import { createServer, Socket } from "node:net";

import { expect, test, vi } from "vitest";

import { smtpServiceFactory, SmtpTemplates } from "./smtp-service";

vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ SITE_URL: "https://vaultix.invalid", isCloud: false }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

test("real recorded SMTP preserves Message-ID and propagates recipient rejection", async () => {
  const sockets = new Set<Socket>();
  const messageIds: string[] = [];
  let rejectRecipient = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let input = "";
    let data = "";
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
            messageIds.push(data.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim() ?? "");
            readingData = false;
            data = "";
            socket.write("250 accepted\r\n");
          } else data += `${line}\n`;
        } else if (/^(EHLO|HELO|MAIL FROM|RSET)/i.test(line)) socket.write("250 OK\r\n");
        else if (/^RCPT TO/i.test(line)) socket.write(rejectRecipient ? "550 recipient rejected\r\n" : "250 OK\r\n");
        else if (line === "DATA") {
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
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected local SMTP port");
    const service = smtpServiceFactory({
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      ignoreTLS: true,
      from: "security@vaultix.invalid"
    });
    const mail = {
      deliveryId: "22222222-2222-4222-8222-222222222222",
      recipients: ["admin@vaultix.invalid"],
      template: SmtpTemplates.OrgAdminBreakglassAccess,
      subjectLine: "Security Alert: SSO Bypass",
      substitutions: {
        email: "owner@vaultix.invalid",
        timestamp: "2026-10-31T00:00:00Z",
        ip: "192.0.2.5",
        userAgent: "Vaultix verification",
        orgId: "33333333-3333-4333-8333-333333333333"
      }
    };
    expect(await service.sendRecordedMail(mail)).toBe("accepted");
    expect(await service.sendRecordedMail(mail)).toBe("accepted");
    expect(messageIds).toEqual(Array.from({ length: 2 }, () => "<22222222-2222-4222-8222-222222222222@vaultix.cloud>"));
    rejectRecipient = true;
    await expect(service.sendRecordedMail(mail)).rejects.toThrow();
    expect(messageIds).toHaveLength(2);
    await expect(
      service.sendRecordedMail({ ...mail, recipients: ["one@vaultix.invalid,two@vaultix.invalid"] })
    ).rejects.toThrow("Invalid recorded mail delivery");
    expect(messageIds).toHaveLength(2);
    rejectRecipient = false;
    await service.sendMail(mail);
    expect(messageIds).toHaveLength(3);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}, 30000);
