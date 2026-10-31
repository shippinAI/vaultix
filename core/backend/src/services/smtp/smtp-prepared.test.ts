import { beforeEach, expect, test, vi } from "vitest";

import { classifyRecordedMailFailure, parsePreparedRecordedMail, RecordedMailError } from "./smtp-recorded-payload";
import { smtpServiceFactory, SmtpTemplates } from "./smtp-service";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), transport: vi.fn(), log: vi.fn(), render: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: mocks.transport }));
vi.mock("@react-email/components", () => ({ render: mocks.render }));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ SITE_URL: "https://vaultix.invalid", isCloud: false }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: mocks.log, error: mocks.log } }));

const deliveryId = "11111111-1111-4111-8111-111111111111";
const payload = {
  version: 1,
  recipient: "admin@vaultix.invalid",
  from: { name: "Vaultix Security", address: "security@vaultix.invalid" },
  subject: "Vaultix security notice",
  html: "<p>Recorded security notice</p>",
  createdAt: "2026-10-31T00:00:00.000Z"
};
const preparation = {
  recipient: payload.recipient,
  template: SmtpTemplates.OrgAdminBreakglassAccess,
  subjectLine: payload.subject,
  substitutions: { email: "owner@vaultix.invalid" },
  createdAt: new Date(payload.createdAt)
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({ accepted: [payload.recipient], rejected: [] });
  mocks.render.mockResolvedValue(payload.html);
});

test("prepares serializable content once and sends the recorded sender, recipient, body and date without rendering", async () => {
  const service = smtpServiceFactory({
    host: "smtp.vaultix.invalid",
    from: "Vaultix Security <security@vaultix.invalid>"
  });
  const prepared = await service.prepareRecordedMail(preparation);
  expect(prepared).toEqual(payload);
  const sender = smtpServiceFactory({ host: "changed.vaultix.invalid", from: "changed@vaultix.invalid" });
  mocks.render.mockRejectedValue(new Error("changed template must not be read"));
  expect(await sender.sendPreparedRecordedMail(deliveryId, JSON.parse(JSON.stringify(prepared)))).toBe("accepted");
  expect(await sender.sendPreparedRecordedMail(deliveryId, prepared)).toBe("accepted");
  expect(mocks.render).toHaveBeenCalledTimes(1);
  expect(mocks.sendMail.mock.calls[0]).toEqual(mocks.sendMail.mock.calls[1]);
  expect(mocks.sendMail).toHaveBeenCalledWith({
    from: payload.from,
    to: payload.recipient,
    envelope: { from: payload.from.address, to: [payload.recipient] },
    subject: payload.subject,
    html: payload.html,
    date: new Date(payload.createdAt),
    messageId: `<${deliveryId}@vaultix.cloud>`,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  expect(mocks.log).not.toHaveBeenCalled();
});

test("disabled SMTP does not render, send or log a prepared or unprepared notice", async () => {
  const service = smtpServiceFactory({});
  expect(await service.prepareRecordedMail(preparation)).toBeNull();
  expect(await service.sendPreparedRecordedMail(deliveryId, payload)).toBe("disabled");
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.sendMail).not.toHaveBeenCalled();
  expect(mocks.log).not.toHaveBeenCalled();
});

test.each([
  null,
  [],
  { ...payload, version: 2 },
  { ...payload, recipient: "first@vaultix.invalid,second@vaultix.invalid" },
  { ...payload, recipient: "first@vaultix.invalid\r\nBcc: second@vaultix.invalid" },
  { ...payload, recipient: "Name <first@vaultix.invalid>" },
  { ...payload, from: { ...payload.from, address: "first@vaultix.invalid;second@vaultix.invalid" } },
  { ...payload, from: { ...payload.from, name: "Name\nInjected" } },
  { ...payload, from: { ...payload.from, auth: "canary-not-allowed" } },
  { ...payload, subject: "" },
  { ...payload, subject: "Subject\r\nBcc: other@vaultix.invalid" },
  { ...payload, subject: "x".repeat(256) },
  { ...payload, html: { path: "/tmp/private-canary" } },
  { ...payload, html: "x".repeat(49153) },
  { ...payload, html: "\u{1f512}".repeat(20000) },
  { ...payload, html: "" },
  { ...payload, createdAt: "invalid" },
  { ...payload, createdAt: "2026-02-30T00:00:00.000Z" },
  { ...payload, createdAt: "2026-10-31T00:00:00Z" },
  { ...payload, attachments: [{ path: "/tmp/private-canary" }] },
  { ...payload, token: "canary-not-allowed" }
])("rejects invalid or extended recorded payload before any send", async (value) => {
  await expect(
    smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendPreparedRecordedMail(deliveryId, value)
  ).rejects.toMatchObject({ disposition: "invalid" });
  expect(mocks.sendMail).not.toHaveBeenCalled();
  expect(mocks.log).not.toHaveBeenCalled();
});

test("invalid delivery identity is rejected before sending", async () => {
  await expect(
    smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendPreparedRecordedMail("bad-id", payload)
  ).rejects.toMatchObject({ disposition: "invalid" });
  expect(mocks.sendMail).not.toHaveBeenCalled();
});

test.each([
  "first@vaultix.invalid,second@vaultix.invalid",
  "Name\r\nBcc: hidden@vaultix.invalid <first@vaultix.invalid>",
  "Group: first@vaultix.invalid;",
  undefined
])("rejects missing or ambiguous configured sender", async (from) => {
  await expect(
    smtpServiceFactory({ host: "smtp.vaultix.invalid", from }).prepareRecordedMail(preparation)
  ).rejects.toMatchObject({
    disposition: "invalid"
  });
  expect(mocks.sendMail).not.toHaveBeenCalled();
});

test.each([
  { command: "RCPT TO", code: "EENVELOPE", responseCode: 550 },
  { command: "MAIL FROM", responseCode: 450 },
  { command: "AUTH LOGIN", responseCode: 535 },
  { command: "EHLO", responseCode: 421 },
  { command: "STARTTLS", code: "ETLS" },
  { command: "CONN", code: "EDNS" },
  { command: "DATA", responseCode: 451 },
  { command: "DATA", responseCode: 554 }
])("known nonacceptance can be retried without carrying transport content", async (failure) => {
  mocks.sendMail.mockRejectedValue({ ...failure, message: "credential-canary", response: "credential-canary" });
  const error = await smtpServiceFactory({ host: "smtp.vaultix.invalid" })
    .sendPreparedRecordedMail(deliveryId, payload)
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(RecordedMailError);
  expect(error).toMatchObject({ disposition: "retryable" });
  expect(JSON.stringify(error)).not.toContain("credential-canary");
  expect(String(error)).not.toContain("credential-canary");
  expect(mocks.log).not.toHaveBeenCalled();
});

test.each([
  new Error("credential-canary"),
  { command: "DATA", code: "ETIMEDOUT" },
  { command: "CONN", code: "ETIMEDOUT" },
  { command: "CONN", code: "ECONNECTION" },
  { command: "CONN", code: "ESOCKET" },
  { command: "QUIT", responseCode: 500 },
  { command: "DATA", responseCode: 250 },
  { command: "DATA", responseCode: 354 },
  { command: "DATA", responseCode: "550" },
  { command: "UNKNOWN", responseCode: 550 }
])("ambiguous errors remain uncertain including Nodemailer post-DATA CONN errors", async (failure) => {
  mocks.sendMail.mockRejectedValue(failure);
  await expect(
    smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendPreparedRecordedMail(deliveryId, payload)
  ).rejects.toMatchObject({ disposition: "uncertain" });
  expect(mocks.log).not.toHaveBeenCalled();
});

test.each([
  { accepted: [], rejected: [] },
  { accepted: ["other@vaultix.invalid"], rejected: [] },
  { accepted: [payload.recipient], rejected: [payload.recipient] }
])("inconsistent SMTP acceptance never becomes acknowledged or safe to retry", async (result) => {
  mocks.sendMail.mockResolvedValue(result);
  await expect(
    smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendPreparedRecordedMail(deliveryId, payload)
  ).rejects.toMatchObject({ disposition: "uncertain" });
});

test("explicit sole recipient rejection is retryable", async () => {
  mocks.sendMail.mockResolvedValue({ accepted: [], rejected: [payload.recipient] });
  await expect(
    smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendPreparedRecordedMail(deliveryId, payload)
  ).rejects.toMatchObject({ disposition: "retryable" });
});

test("snapshot parser returns detached data and never includes unknown fields", () => {
  const parsed = parsePreparedRecordedMail(payload);
  parsed.from.name = "Changed";
  expect(payload.from.name).toBe("Vaultix Security");
  expect(classifyRecordedMailFailure(null).disposition).toBe("uncertain");
});

test("recorded transport overrides diagnostic logging even when configured globally", () => {
  smtpServiceFactory({ host: "smtp.vaultix.invalid", logger: true, debug: true });
  expect(mocks.transport.mock.calls[1][0]).toMatchObject({ logger: false, debug: false });
});

test.each(["accepted", "rejected"] as const)(
  "matches internationalized mailbox normalization in SMTP %s results",
  async (outcome) => {
    mocks.sendMail.mockResolvedValue({ accepted: [], rejected: [], [outcome]: ["admin@xn--bcher-kva.invalid"] });
    const result = smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendPreparedRecordedMail(deliveryId, {
      ...payload,
      recipient: "admin@b\u00fccher.invalid"
    });
    if (outcome === "accepted") expect(await result).toBe("accepted");
    else await expect(result).rejects.toMatchObject({ disposition: "retryable" });
  }
);
