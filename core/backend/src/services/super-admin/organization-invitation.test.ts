import { describe, expect, it, vi } from "vitest";

import { deliverOrganizationInvitation } from "./organization-invitation";

vi.mock("@app/lib/logger", () => ({ logger: { error: vi.fn() } }));

const email = "person@example.com";
const link = "https://vaultix.invalid/signupinvite?token=secret";
const createLink = async () => link;

describe("deliverOrganizationInvitation", () => {
  it("does not return the link once mail was accepted", async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    await expect(
      deliverOrganizationInvitation({ email, isSmtpConfigured: true, createLink, sendMail })
    ).resolves.toEqual({
      email,
      delivery: "email"
    });
    expect(sendMail).toHaveBeenCalledWith(link);
  });

  it("returns the link when SMTP is not configured, since mail goes nowhere", async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    await expect(
      deliverOrganizationInvitation({ email, isSmtpConfigured: false, createLink, sendMail })
    ).resolves.toEqual({
      email,
      delivery: "link",
      link
    });
  });

  it("falls back to the link when configured SMTP fails", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("connection refused"));
    await expect(
      deliverOrganizationInvitation({ email, isSmtpConfigured: true, createLink, sendMail })
    ).resolves.toEqual({
      email,
      delivery: "link",
      link
    });
  });

  it("reports failure without sending when no link could be created", async () => {
    const sendMail = vi.fn();
    await expect(
      deliverOrganizationInvitation({
        email,
        isSmtpConfigured: true,
        createLink: () => Promise.reject(new Error("database unavailable")),
        sendMail
      })
    ).resolves.toEqual({ email, delivery: "failed" });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
