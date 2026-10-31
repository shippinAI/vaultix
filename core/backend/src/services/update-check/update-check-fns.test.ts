import {
  isUpdateCheckEnabled,
  isVersionNewer,
  parseSemanticVersion,
  readStableRelease,
  TSemanticVersion,
  TUpdateCheckGateInput
} from "./update-check-fns";

const version = (value: string): TSemanticVersion => {
  const parsed = parseSemanticVersion(value);
  if (!parsed) throw new Error(`Invalid test version: ${value}`);
  return parsed;
};

describe("parseSemanticVersion", () => {
  test("parses plain semantic versions", () => {
    expect(parseSemanticVersion("0.162.10")).toEqual({ major: 0, minor: 162, patch: 10 });
  });

  test("parses versions with a leading v", () => {
    expect(parseSemanticVersion("v0.162.10")).toEqual({ major: 0, minor: 162, patch: 10 });
    expect(parseSemanticVersion("V0.162.10")).toEqual({ major: 0, minor: 162, patch: 10 });
  });

  test("preserves nightly/prerelease precedence", () => {
    expect(parseSemanticVersion("0.163.0-nightly-20260721")).toEqual({
      major: 0,
      minor: 163,
      patch: 0,
      prerelease: ["nightly-20260721"]
    });
    expect(parseSemanticVersion("v0.163.0-nightly-20260721.1")).toEqual({
      major: 0,
      minor: 163,
      patch: 0,
      prerelease: ["nightly-20260721", "1"]
    });
  });

  test("returns null for values that are not semver-shaped", () => {
    expect(parseSemanticVersion(undefined)).toBeNull();
    expect(parseSemanticVersion("")).toBeNull();
    // dedicated instances use commit hash versions
    expect(parseSemanticVersion("a1b2c3d")).toBeNull();
    expect(parseSemanticVersion("0.162")).toBeNull();
    expect(parseSemanticVersion("0.162.10.1")).toBeNull();
    expect(parseSemanticVersion("latest")).toBeNull();
  });
});

test("stable releases outrank prereleases; numeric identifiers use numeric precedence", () => {
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0"
  ];
  ordered.forEach((a, i) => ordered.forEach((b, k) => expect(isVersionNewer(version(a), version(b))).toBe(i > k)));
  expect(isVersionNewer(version("1.0.0+build.9"), version("1.0.0+build.1"))).toBe(false);
  for (const input of [
    "01.2.3",
    "1.02.3",
    "1.2.3-01",
    "1.2.3-",
    "1.2.3+",
    "1.2.3-rc..1",
    "1.2.3/evil",
    "9007199254740992.0.0"
  ])
    expect(parseSemanticVersion(input)).toBeNull();
});

test("only published stable tags produce an owned release destination", () => {
  const good = {
    tag_name: "v2.0.0",
    draft: false,
    prerelease: false,
    published_at: "2026-10-31T12:00:00Z",
    html_url: "https://untrusted.invalid/"
  };
  expect(readStableRelease(good)).toEqual({
    version: "2.0.0",
    url: "https://github.com/shippinAI/vaultix/releases/tag/v2.0.0"
  });
  for (const input of [
    null,
    {},
    { ...good, draft: true },
    { ...good, prerelease: true },
    { ...good, tag_name: "v3.0.0-rc.1" },
    { ...good, tag_name: "v3.0.0\n" },
    { ...good, published_at: "invalid" }
  ])
    expect(readStableRelease(input)).toBeNull();
});

describe("isVersionNewer", () => {
  test("returns false for equal versions", () => {
    expect(isVersionNewer(version("0.162.10"), version("0.162.10"))).toBe(false);
  });

  test("compares patch versions", () => {
    expect(isVersionNewer(version("0.162.11"), version("0.162.10"))).toBe(true);
    expect(isVersionNewer(version("0.162.9"), version("0.162.10"))).toBe(false);
  });

  test("a minor bump outranks a higher patch", () => {
    expect(isVersionNewer(version("0.163.0"), version("0.162.10"))).toBe(true);
    expect(isVersionNewer(version("0.162.10"), version("0.163.0"))).toBe(false);
  });

  test("a major bump outranks a higher minor", () => {
    expect(isVersionNewer(version("1.0.0"), version("0.999.999"))).toBe(true);
  });

  test("compares numerically, not lexicographically", () => {
    expect(isVersionNewer(version("0.10.0"), version("0.9.0"))).toBe(true);
    expect(isVersionNewer(version("0.100.0"), version("0.99.0"))).toBe(true);
  });
});

describe("isUpdateCheckEnabled", () => {
  const connectedSelfHosted: TUpdateCheckGateInput = {
    isVaultixCloud: false,
    isCloud: false,
    isUpdateCheckDisabled: false,
    hasOfflineLicense: false,
    platformVersion: "0.162.10"
  };

  test("enabled for a standard self-hosted instance with a semver version", () => {
    expect(isUpdateCheckEnabled(connectedSelfHosted)).toBe(true);
  });

  test("disabled on cloud instances", () => {
    expect(isUpdateCheckEnabled({ ...connectedSelfHosted, isVaultixCloud: true })).toBe(false);
    expect(isUpdateCheckEnabled({ ...connectedSelfHosted, isCloud: true })).toBe(false);
  });

  test("disabled by the DISABLE_UPDATE_CHECK flag", () => {
    expect(isUpdateCheckEnabled({ ...connectedSelfHosted, isUpdateCheckDisabled: true })).toBe(false);
  });

  test("disabled when an offline license is configured", () => {
    expect(isUpdateCheckEnabled({ ...connectedSelfHosted, hasOfflineLicense: true })).toBe(false);
  });

  test("disabled without a comparable platform version", () => {
    expect(isUpdateCheckEnabled({ ...connectedSelfHosted, platformVersion: undefined })).toBe(false);
    // dedicated instances use commit hash versions
    expect(isUpdateCheckEnabled({ ...connectedSelfHosted, platformVersion: "a1b2c3d" })).toBe(false);
  });
});
