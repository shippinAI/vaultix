import { describe, expect, it } from "vitest";

import { identityPolicyEnvironment, parseIdentityTokenMaxAge } from "./identity-token-policy";

describe("Vaultix identity token lifetime policy", () => {
  it.each([
    ["", 7_776_000],
    [" 90d ", 7_776_000],
    [" \t ", 7_776_000],
    ["90d", 7_776_000],
    ["2 HOURS", 7_200],
    [".5h", 1_800],
    ["1.999s", 1],
    ["1999", 1],
    ["2 weeks", 1_209_600],
    ["1y", 31_557_600],
    ["9223372036s", 9_223_372_036]
  ])("preserves issuer duration %s", (input, seconds) => {
    expect(parseIdentityTokenMaxAge(String(input))).toBe(seconds);
  });

  it.each(["nonsense", "0", "-1s", "500ms", "999999999999999999years", "1h30m", "1e3s", "9223372037s"])(
    "rejects invalid lifetime %s before startup",
    (input) => {
      expect(() => parseIdentityTokenMaxAge(input)).toThrow("MAX_MACHINE_IDENTITY_TOKEN_AGE");
    }
  );

  it.each(["2026-05-04", "2026-05-03T20:00:00-04:00", "Mon, 04 May 2026 00:00:00 GMT"])(
    "preserves the issuer's resolved date for %s",
    (input) => {
      expect(
        identityPolicyEnvironment({
          MAX_MACHINE_IDENTITY_TOKEN_AGE: 7_200,
          LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: new Date(input)
        })
      ).toEqual({
        MAX_MACHINE_IDENTITY_TOKEN_AGE: "7200s",
        LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: "unix-ms:1777852800000"
      });
    }
  );
  it.each([-8_640_000_000_000_000, -1, 0, 8_640_000_000_000_000])(
    "preserves the full JavaScript date range at %s milliseconds",
    (milliseconds) => {
      expect(
        identityPolicyEnvironment({
          MAX_MACHINE_IDENTITY_TOKEN_AGE: 1,
          LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: new Date(milliseconds)
        }).LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT
      ).toBe(`unix-ms:${milliseconds}`);
    }
  );
});
