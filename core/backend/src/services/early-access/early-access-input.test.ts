import { describe, expect, it, vi } from "vitest";

import { BadRequestError } from "@app/lib/errors";

import {
  parseEarlyAccessBulkDelete,
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
    ["long address", { email: `a@${"b".repeat(250)}.com` }],
    ["a NUL", { email: "a\u0000b@example.com" }],
    ["a directional override", { email: "\u202emoc.emca@eoj.ms" }],
    ["a zero-width character", { email: "per\u200bson@example.com" }],
    ["markup", { email: "<img>@example.com" }],
    ["non-ASCII", { email: "pérson@example.com" }],
    ["a non-ASCII domain", { email: "person@exämple.com" }],
    ["a leading dot", { email: ".person@example.com" }],
    ["two dots", { email: "per..son@example.com" }],
    ["a numeric top-level domain", { email: "person@127.0.0.11" }]
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
    ["a non-text note", { email: "a@example.com", useCase: { toString: "x" } }],
    ["a directional override in the name", { email: "a@example.com", name: "a\u202eb" }],
    ["a directional isolate in the organization", { email: "a@example.com", organization: "a\u2066b" }],
    ["a directional override in the note", { email: "a@example.com", useCase: "a\u202eb" }],
    ["a C1 control in the name", { email: "a@example.com", name: "a\u0085b" }]
  ])("rejects %s", (_label, body) => {
    expect(() => parseEarlyAccessSubmission(body)).toThrow(BadRequestError);
  });

  it.each([["plus.tag+x@example.com"], ["o'brien@example.co.uk"], ["a_b-c@sub-domain.example.org"]])(
    "accepts the ordinary address %s",
    (email) => {
      expect(parseEarlyAccessSubmission({ email })?.email).toBe(email);
    }
  );

  it("keeps the joiners that names and emoji need", () => {
    const name = "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645 \u{1F469}\u200d\u{1F4BB}";
    expect(parseEarlyAccessSubmission({ email: "a@example.com", name })?.name).toBe(name);
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

describe("parseEarlyAccessBulkDelete", () => {
  it("takes a status and an optional search", () => {
    expect(parseEarlyAccessBulkDelete({ status: "pending", search: " spam " })).toEqual({
      status: "pending",
      search: "spam"
    });
    expect(parseEarlyAccessBulkDelete({ status: "declined" })).toEqual({ status: "declined", search: undefined });
  });

  it.each([[{}], [{ status: "invited" }], [{ status: "all" }], ["pending"], [{ status: "pending", search: 1 }]])(
    "rejects %j",
    (body) => {
      expect(() => parseEarlyAccessBulkDelete(body)).toThrow(BadRequestError);
    }
  );
});

describe("parseEarlyAccessInvite", () => {
  it("trims a valid organization name", () => {
    expect(parseEarlyAccessInvite({ organizationName: "  Acme Labs " })).toEqual({ organizationName: "Acme Labs" });
  });

  it.each([
    [{}],
    [{ organizationName: "" }],
    [{ organizationName: "a".repeat(65) }],
    [{ organizationName: "<b>" }],
    [{ organizationName: 7 }]
  ])("rejects %j", (body) => {
    expect(() => parseEarlyAccessInvite(body)).toThrow(BadRequestError);
  });
});
