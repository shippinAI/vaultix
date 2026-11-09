export const builtinPasswordLoginPath = "/api/v3/auth/login";
export const builtinPasswordUiPath = "/login";

export type VaultixAuthConfig = {
  schemaVersion: "vaultix.auth.v1";
  instance: string;
  profiles: [
    {
      id: "builtin-password";
      method: "password";
      loginPath: typeof builtinPasswordLoginPath;
      uiPath: typeof builtinPasswordUiPath;
      requiresExternalIssuer: false;
    }
  ];
  cli: {
    interactiveDefault: "sso";
    preservedModes: ["token", "universal", "sso"];
    deviceAuthorization: false;
    defaultChange: "undecided";
  };
};

// Keeps userinfo and non-http schemes out of a public discovery document.
export const publicInstanceURL = (raw: string | undefined) => {
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.origin;
};

export const getVaultixAuthConfig = (siteURL: string | undefined): VaultixAuthConfig => ({
  schemaVersion: "vaultix.auth.v1",
  instance: publicInstanceURL(siteURL),
  profiles: [
    {
      id: "builtin-password",
      method: "password",
      loginPath: builtinPasswordLoginPath,
      uiPath: builtinPasswordUiPath,
      requiresExternalIssuer: false
    }
  ],
  cli: {
    interactiveDefault: "sso",
    preservedModes: ["token", "universal", "sso"],
    deviceAuthorization: false,
    defaultChange: "undecided"
  }
});
