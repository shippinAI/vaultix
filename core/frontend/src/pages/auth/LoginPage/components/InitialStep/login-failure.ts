export type LoginFailure = {
  kind: "credentials" | "limited" | "unavailable" | "network" | "locked" | "captcha" | "unknown";
  title: string;
  message: string;
  retrySeconds?: number;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

// Accept the server's delta-seconds or HTTP date. Bound malformed/implausible
// headers so they cannot create an indefinite UI lock. The server remains authoritative.
export const loginRetrySeconds = (value: unknown, now = Date.now()): number => {
  if (typeof value !== "string" || value.length > 128) return 60;
  const header = value.trim();
  let seconds = Number.NaN;
  if (/^\d+$/.test(header)) seconds = Number(header);
  else if (/^[A-Za-z]{3}, /.test(header))
    seconds = Math.max(0, Math.ceil((Date.parse(header) - now) / 1000));
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : 60;
};

// Only known status/codes affect the UI. Never display or log request config,
// response text, submitted credentials or arbitrary provider diagnostics.
export const classifyLoginFailure = (error: unknown, now = Date.now()): LoginFailure => {
  const failure = record(error);
  const response = record(failure?.response);
  const data = record(response?.data);
  if (response?.status === 429) {
    return {
      kind: "limited",
      title: "Sign-in Temporarily Limited",
      message:
        "Too many sign-in attempts. Wait before trying again. Your entries stay in this form.",
      retrySeconds: loginRetrySeconds(record(response.headers)?.["retry-after"], now)
    };
  }
  if (typeof response?.status === "number" && response.status >= 500) {
    return {
      kind: "unavailable",
      title: "Sign-in Temporarily Unavailable",
      message:
        "Vaultix could not complete sign-in. Try again shortly. You do not need to change your password."
    };
  }
  if (data?.error === "User Locked") {
    return {
      kind: "locked",
      title: "Account Temporarily Locked",
      message: "Wait before trying again, or contact your administrator for help."
    };
  }
  if (data?.error === "Captcha Required") {
    return {
      kind: "captcha",
      title: "Verification Required",
      message: "Complete the verification below to continue."
    };
  }
  if (
    response?.status === 401 ||
    (response?.status === 400 && data?.message === "Invalid credentials")
  ) {
    return {
      kind: "credentials",
      title: "Check Your Sign-in Details",
      message: "Check your email and password, then try again."
    };
  }
  if (failure?.isAxiosError === true && !response) {
    return {
      kind: "network",
      title: "Connection Interrupted",
      message:
        "Vaultix could not confirm sign-in. Check your connection, then try again. Your entries stay in this form."
    };
  }
  return {
    kind: "unknown",
    title: "Sign-in Could Not Finish",
    message: "Try again. If this continues, contact your administrator."
  };
};
