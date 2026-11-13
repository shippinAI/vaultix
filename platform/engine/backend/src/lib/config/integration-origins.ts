const MAX_INTEGRATION_ORIGINS = 32;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const refuse = (detail: string): never => {
  throw new Error(
    `VAULTIX_INTEGRATION_ORIGINS must be a JSON array of exact origins such as ["https://nomen.example.com"]: ${detail}`
  );
};

const exactOrigin = (entry: unknown): string => {
  if (typeof entry !== "string") return refuse("every entry must be a string");
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return refuse(`${JSON.stringify(entry)} is not an origin`);
  }
  if (url.origin === "null" || url.origin !== entry) {
    return refuse(`${JSON.stringify(entry)} is not written as its exact origin (${url.origin})`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return refuse(`${JSON.stringify(entry)} must use https (plain http is allowed only on loopback)`);
  }
  return entry;
};

// Partner applications allowed to open /integrations/save-secret (docs/0125). Empty means off.
export const parseIntegrationOrigins = (raw: string | undefined): string[] => {
  if (raw === undefined || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse("the value is not JSON");
  }
  if (!Array.isArray(parsed)) return refuse("the value is not an array");
  if (parsed.length > MAX_INTEGRATION_ORIGINS) return refuse(`at most ${MAX_INTEGRATION_ORIGINS} origins`);
  return [...new Set(parsed.map(exactOrigin))];
};
