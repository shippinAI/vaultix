import { describe, expect, it, vi } from "vitest";

import { BadRequestError } from "@app/lib/errors";

import {
  parseEarlyAccessInvite,
  parseEarlyAccessListQuery,
  parseEarlyAccessRequestId,
  parseEarlyAccessSubmission
} from "./early-access-input";

// The native addon is only built inside the image; the patterns under test are plain regular expressions.
vi.mock("re2", () => ({ default: RegExp }));

describe("parseEarlyAccessSubmission", () => {
  it("normalizes the email and trims optional text", () => {
    expect(
      parseEarlyAccessSubmission({
        email: "  Person@Example.COM ",
        name: " Sam ",
        organization: "",
        useCase: "line one\nline two"
      })
    ).toEqual({ email: "person@example.com", name: "Sam", organization: null, useCase: "line one\nline two" });
  });

  it("treats a filled hidden field as automated, without validating the rest", () => {
    expect(parseEarlyAccessSubmission({ email: "not-an-email", website: "https://spam.invalid" })).toBeNull();
  });

  it.each([
    ["missing", {}],
    ["not text", { email: 42 }],
    ["no domain", { email: "person@" }],
    ["no tld", { email: "person@example" }],
    ["two at signs", { email: "a@b@example.com" }],
    ["inner space", { email: "a b@example.com" }],
    ["long local part", { email: `${"a".repeat(65)}@example.com` }],
    ["long address", { email: `a@${"b".repeat(250)}.com` }]
  ])("rejects an email that is %s", (_label, body) => {
    expect(() => parseEarlyAccessSubmission(body)).toThrow(BadRequestError);
  });

  it.each([
    ["a non-object body", "email=a@example.com"],
    ["an array body", [{ email: "a@example.com" }]],
    ["an unknown field", { email: "a@example.com", status: "invited" }],
    ["a reviewer field", { email: "a@example.com", reviewedByUserId: "someone" }],
    ["a long name", { email: "a@example.com", name: "n".repeat(129) }],
    ["a long note", { email: "a@example.com", useCase: "n".repeat(1001) }],
    ["a NUL in the name", { email: "a@example.com", name: "a\u0000b" }],
    ["a newline in the organization", { email: "a@example.com", organization: "a\nb" }],
    ["a NUL in the note", { email: "a@example.com", useCase: "a\u0000b" }],
    ["a non-text note", { email: "a@example.com", useCase: { toString: "x" } }]
  ])("rejects %s", (_label, body) => {
    expect(() => parseEarlyAccessSubmission(body)).toThrow(BadRequestError);
  });

  it("keeps markup as plain text for the page to escape", () => {
    expect(parseEarlyAccessSubmission({ email: "a@example.com", useCase: "<img src=x>" })?.useCase).toBe("<img src=x>");
  });
});

describe("parseEarlyAccessListQuery", () => {
  it("applies defaults", () => {
    expect(parseEarlyAccessListQuery({})).toEqual({ status: undefined, search: undefined, limit: 25, offset: 0 });
  });

  it("accepts known statuses and bounded pages", () => {
    expect(parseEarlyAccessListQuery({ status: "declined", search: " acme ", limit: "100", offset: "50" })).toEqual({
      status: "declined",
      search: "acme",
      limit: 100,
      offset: 50
    });
  });

  it.each([
    [{ status: "approved" }],
    [{ status: ["pending"] }],
    [{ limit: "101" }],
    [{ limit: "-1" }],
    [{ limit: "1e3" }],
    [{ offset: "1000001" }],
    [{ search: "s".repeat(129) }]
  ])("rejects %j", (query) => {
    expect(() => parseEarlyAccessListQuery(query)).toThrow(BadRequestError);
  });
});

describe("parseEarlyAccessRequestId", () => {
  it("accepts a uuid", () => {
    const requestId = "3f2b8c1e-7d4a-4b6e-9a10-2c5d8e7f1a3b";
    expect(parseEarlyAccessRequestId({ requestId })).toBe(requestId);
  });

  it.each([["not-a-uuid"], ["3f2b8c1e-7d4a-4b6e-9a10-2c5d8e7f1a3b' OR 1=1"], [undefined]])(
    "rejects %s",
    (requestId) => {
      expect(() => parseEarlyAccessRequestId({ requestId })).toThrow(BadRequestError);
    }
  );
});

describe("parseEarlyAccessInvite", () => {
  it("trims a valid organization name", () => {
    expect(parseEarlyAccessInvite({ organizationName: "  Acme Labs " })).toEqual({ organizationName: "Acme Labs" });
  });

  it.each([[{}], [{ organizationName: "" }], [{ organizationName: "a".repeat(65) }], [{ organizationName: "<b>" }]])(
    "rejects %j",
    (body) => {
      expect(() => parseEarlyAccessInvite(body)).toThrow(BadRequestError);
    }
  );
});
