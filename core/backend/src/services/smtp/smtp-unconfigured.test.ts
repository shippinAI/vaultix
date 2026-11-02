import { beforeEach, expect, test, vi } from "vitest";

import { smtpServiceFactory, SmtpTemplates } from "./smtp-service";

const mocks = vi.hoisted(() => ({ log: vi.fn(), render: vi.fn(), config: { isDevelopmentMode: false } }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: vi.fn(), close: vi.fn() }) }));
vi.mock("@react-email/components", () => ({ render: mocks.render }));
vi.mock("@app/lib/config/env", () => ({
  getConfig: () => ({ SITE_URL: "https://vaultix.invalid", isCloud: false, ...mocks.config })
}));
vi.mock("@app/lib/logger", () => ({ logger: { info: mocks.log, error: mocks.log } }));

const secret = "invite-token-canary";
const mail = {
  template: SmtpTemplates.OrgInvite,
  subjectLine: `Vaultix confirmation code: ${secret}`,
  recipients: ["invitee@vaultix.invalid", "second@vaultix.invalid"],
  substitutions: { callback_url: `https://vaultix.invalid/signupinvite?token=${secret}` }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.isDevelopmentMode = false;
  mocks.render.mockResolvedValue(`<a href="https://vaultix.invalid/signupinvite?token=${secret}">Join</a>`);
});

test("logs only the template and recipient count outside development", async () => {
  await smtpServiceFactory({ from: "Vaultix <mail@vaultix.invalid>" }).sendMail(mail);

  expect(mocks.log).toHaveBeenCalledTimes(1);
  expect(mocks.log).toHaveBeenCalledWith(
    { template: SmtpTemplates.OrgInvite, recipientCount: 2 },
    "SMTP is not configured. Email was not sent"
  );
  const logged = JSON.stringify(mocks.log.mock.calls);
  expect(logged).not.toContain(secret);
  expect(logged).not.toContain("invitee@vaultix.invalid");
});

test("keeps full terminal output for local development", async () => {
  mocks.config.isDevelopmentMode = true;

  await smtpServiceFactory({ from: "Vaultix <mail@vaultix.invalid>" }).sendMail(mail);

  expect(JSON.stringify(mocks.log.mock.calls)).toContain(secret);
});
