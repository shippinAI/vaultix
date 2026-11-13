const MAX_RETURN_PATH = 2048;

// A sign-in return target is followed only when it stays on this origin, and is always
// returned as a relative path so window.location.assign cannot leave the application.
export const toSafeReturnPath = (raw: unknown, origin: string): string | undefined => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN_PATH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return undefined;
  if (!raw.startsWith("/") && !raw.startsWith(`${origin}/`)) return undefined;
  if (raw.startsWith("//")) return undefined;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  return path;
};
