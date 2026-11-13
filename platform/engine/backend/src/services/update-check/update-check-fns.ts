export const parseSemanticVersion = (version?: string) => {
  if (!version || version.length > 128) return null;
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/i.exec(
      version.trim()
    );
  if (!match) return null;
  const prerelease = match[4]?.split(".");
  if (prerelease?.some((part) => /^0\d+$/.test(part))) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, ...(prerelease ? { prerelease } : {}) };
};

export type TSemanticVersion = NonNullable<ReturnType<typeof parseSemanticVersion>>;

export const isVersionNewer = (candidate: TSemanticVersion, current: TSemanticVersion) => {
  if (candidate.major !== current.major) return candidate.major > current.major;
  if (candidate.minor !== current.minor) return candidate.minor > current.minor;
  if (candidate.patch !== current.patch) return candidate.patch > current.patch;
  if (!candidate.prerelease) return Boolean(current.prerelease);
  if (!current.prerelease) return false;
  for (let i = 0; i < Math.min(candidate.prerelease.length, current.prerelease.length); i += 1) {
    const a = candidate.prerelease[i];
    const b = current.prerelease[i];
    if (a !== b) {
      const an = /^\d+$/.test(a);
      const bn = /^\d+$/.test(b);
      if (an !== bn) return !an;
      if (an && a.length !== b.length) return a.length > b.length;
      return a > b;
    }
  }
  return candidate.prerelease.length > current.prerelease.length;
};

export type TUpdateCheckGateInput = {
  isVaultixCloud: boolean;
  isCloud: boolean;
  isUpdateCheckDisabled: boolean;
  platformVersion?: string;
};

export const isUpdateCheckEnabled = (input: TUpdateCheckGateInput) =>
  !input.isVaultixCloud &&
  !input.isCloud &&
  !input.isUpdateCheckDisabled &&
  Boolean(parseSemanticVersion(input.platformVersion));

export const RELEASES_URL = "https://github.com/shippinAI/vaultix/releases";
export const LATEST_RELEASE_URL = "https://api.github.com/repos/shippinAI/vaultix/releases/latest";

export const readStableRelease = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    value.draft !== false ||
    value.prerelease !== false ||
    typeof value.tag_name !== "string" ||
    value.tag_name !== value.tag_name.trim() ||
    typeof value.published_at !== "string" ||
    !Number.isFinite(Date.parse(value.published_at))
  )
    return null;
  const parsed = parseSemanticVersion(value.tag_name);
  if (!parsed || parsed.prerelease) return null;
  return { version: value.tag_name.replace(/^v/i, ""), url: `${RELEASES_URL}/tag/${value.tag_name}` };
};
