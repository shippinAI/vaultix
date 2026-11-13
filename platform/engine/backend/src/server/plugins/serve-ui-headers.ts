const INTEGRATION_PAGES = new Set(["/integrations/save-secret", "/integrations/save-secret/"]);

// The handoff popup (docs/0125) must never be framed and must keep window.opener, which the
// application-wide Cross-Origin-Opener-Policy: same-origin would sever for a partner opener.
export const integrationPageHeaders = (url: string): Record<string, string> => {
  const path = url.split(/[?#]/, 1)[0];
  if (!INTEGRATION_PAGES.has(path)) return {};
  return {
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "unsafe-none"
  };
};
