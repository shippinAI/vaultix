import { ms } from "../ms";

// Go's cache API stores time.Duration. Reject overflow in both processes before
// either one can turn an invalid duration into an authentication policy.
const MAX_AGE_SECONDS = 9_223_372_036;

export const parseIdentityTokenMaxAge = (value: string): number => {
  const seconds = Math.floor(ms(value.trim() || "90d") / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_AGE_SECONDS) {
    throw new Error("MAX_MACHINE_IDENTITY_TOKEN_AGE must resolve to 1 through 9223372036 whole seconds");
  }
  return seconds;
};

type IdentityPolicyConfig = {
  MAX_MACHINE_IDENTITY_TOKEN_AGE: number;
  LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: Date;
};

export const identityPolicyEnvironment = (config: IdentityPolicyConfig): Record<string, string> => ({
  MAX_MACHINE_IDENTITY_TOKEN_AGE: `${config.MAX_MACHINE_IDENTITY_TOKEN_AGE}s`,
  // The issuer accepts JavaScript Date inputs. Forward its resolved instant,
  // including timezone interpretation, rather than asking Go to reinterpret it.
  LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT: `unix-ms:${config.LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT.getTime()}`
});
