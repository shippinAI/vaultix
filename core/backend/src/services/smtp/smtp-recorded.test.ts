import { beforeEach, expect, test, vi } from "vitest";

import { smtpServiceFactory, SmtpTemplates } from "./smtp-service";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), transport: vi.fn(), log: vi.fn(), render: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: mocks.transport }));
vi.mock("@react-email/components", () => ({ render: mocks.render }));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ SITE_URL: "https://vaultix.invalid", isCloud: false }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: mocks.log, error: mocks.log } }));

const mail = {
  deliveryId: "11111111-1111-4111-8111-111111111111",
  recipients: ["admin@vaultix.invalid"],
  template: SmtpTemplates.OrgAdminBreakglassAccess,
  subjectLine: "Security Alert: SSO Bypass",
  substitutions: { email: "owner@vaultix.invalid" }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({ accepted: mail.recipients, rejected: [] });
  mocks.render.mockResolvedValue("<html>security notification</html>");
});

test("recorded mail reports unconfigured SMTP without rendering or logging message contents", async () => {
  const service = smtpServiceFactory({});
  expect(await service.sendRecordedMail(mail)).toBe("disabled");
  expect(mocks.sendMail).not.toHaveBeenCalled();
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.log).not.toHaveBeenCalled();
});

test("recorded SMTP uses bounded transport and a stable message identity on retry", async () => {
  const service = smtpServiceFactory({ host: "smtp.vaultix.invalid" });
  expect(mocks.transport.mock.calls[1][0]).toMatchObject({
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  expect(await service.sendRecordedMail(mail)).toBe("accepted");
  expect(await service.sendRecordedMail(mail)).toBe("accepted");
  expect(mocks.sendMail.mock.calls[1]).toEqual(mocks.sendMail.mock.calls[0]);
  expect(mocks.sendMail.mock.calls[0][0]).toMatchObject({
    messageId: "<11111111-1111-4111-8111-111111111111@vaultix.cloud>"
  });
  expect(mocks.log).not.toHaveBeenCalled();
});

test.each([
  { accepted: [], rejected: mail.recipients },
  { accepted: mail.recipients, rejected: mail.recipients }
])("does not acknowledge incomplete SMTP acceptance", async (result) => {
  mocks.sendMail.mockResolvedValue(result);
  await expect(smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendRecordedMail(mail)).rejects.toThrow(
    "not accepted"
  );
});

test("transport failure remains retryable and is not logged with mail contents", async () => {
  mocks.sendMail.mockRejectedValue(new Error("transport unavailable"));
  await expect(smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendRecordedMail(mail)).rejects.toThrow(
    "transport unavailable"
  );
  expect(mocks.log).not.toHaveBeenCalled();
});

test.each([
  { deliveryId: "invalid" },
  { recipients: [] },
  { recipients: ["one@vaultix.invalid,two@vaultix.invalid"] },
  { recipients: ["one@vaultix.invalid", "two@vaultix.invalid"] }
])("rejects ambiguous delivery identity or recipients", async (invalid) => {
  await expect(
    smtpServiceFactory({ host: "smtp.vaultix.invalid" }).sendRecordedMail({ ...mail, ...invalid })
  ).rejects.toThrow("Invalid recorded mail delivery");
  expect(mocks.sendMail).not.toHaveBeenCalled();
});
