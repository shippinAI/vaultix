export const builtinPasswordLoginPath = "/api/v3/auth/login";
export const builtinPasswordUiPath = "/login";
export const builtinUniversalLoginPath = "/api/v1/auth/universal-auth/login";

export type VaultixAuthProfile = {
  id: string;
  method: string;
  requiresExternalIssuer: boolean;
  loginPath?: string;
  uiPath?: string;
  issuer?: string;
};

export type VaultixAuthConfig = {
  schemaVersion: "vaultix.auth.v1";
  instance: string;
  profiles: VaultixAuthProfile[];
  cli: {
    headless: ["token", "universal"];
    headlessRequiresSso: false;
    interactiveTerminalDefault: "sso";
    deviceAuthorization: false;
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

const builtinProfiles = (): VaultixAuthProfile[] => [
  {
    id: "builtin-password",
    method: "password",
    loginPath: builtinPasswordLoginPath,
    uiPath: builtinPasswordUiPath,
    requiresExternalIssuer: false
  },
  {
    id: "builtin-universal",
    method: "universal-auth",
    loginPath: builtinUniversalLoginPath,
    requiresExternalIssuer: false
  },
  {
    id: "builtin-token",
    method: "access-token",
    requiresExternalIssuer: false
  }
];

// issuer is optional configuration for the existing SSO/device client. An empty
// value leaves that profile off. Headless token and universal login stay present.
export const getVaultixAuthConfig = (siteURL: string | undefined, issuer?: string): VaultixAuthConfig => {
  const profiles = builtinProfiles();
  const publicIssuer = publicInstanceURL(issuer);
  if (publicIssuer) {
    profiles.push({
      id: "sso",
      method: "oidc-device",
      requiresExternalIssuer: true,
      issuer: publicIssuer
    });
  }
  return {
    schemaVersion: "vaultix.auth.v1",
    instance: publicInstanceURL(siteURL),
    profiles,
    cli: {
      headless: ["token", "universal"],
      headlessRequiresSso: false,
      interactiveTerminalDefault: "sso",
      deviceAuthorization: false
    }
  };
};
