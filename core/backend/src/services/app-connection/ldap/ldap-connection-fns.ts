import { isIP } from "node:net";

import { Client } from "ldapts";

import { TGatewayServiceFactory } from "@app/shippin/services/gateway/gateway-service";
import { TGatewayPoolServiceFactory } from "@app/shippin/services/gateway-pool/gateway-pool-service";
import { TGatewayV2ServiceFactory } from "@app/shippin/services/gateway-v2/gateway-v2-service";
import { getConfig } from "@app/lib/config/env";
import { BadRequestError } from "@app/lib/errors";
import { GatewayProxyProtocol } from "@app/lib/gateway";
import { withGatewayV2Proxy } from "@app/lib/gateway-v2/gateway-v2";
import { blockLocalAndPrivateIpAddresses } from "@app/lib/validator";
import { AppConnection } from "@app/services/app-connection/app-connection-enums";

import { LdapConnectionMethod } from "./ldap-connection-enums";
import { TLdapConnectionConfig } from "./ldap-connection-types";

const LDAP_TIMEOUT = 15_000;

/**
 * Extracts the domain from the DC components of a Distinguished Name.
 * e.g. "dc=us,dc=test,dc=com" → "us.test.com"
 */
export const extractDomainFromDN = (dn: string): string | null => {
  if (!dn) return null;

  const dcComponents = dn
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase().startsWith("dc="))
    .map((part) => part.substring(3).toLowerCase());

  return dcComponents.length > 0 ? dcComponents.join(".") : null;
};

/**
 * Extracts the hostname from an LDAP referral URL.
 * e.g. "ldap://dc2.americas.test.com:389/CN=user,DC=americas,DC=test,DC=com" → "dc2.americas.test.com"
 */
export const extractHostFromReferralUrl = (referralUrl: string): string | null => {
  try {
    const url = new URL(referralUrl);
    return url.hostname || null;
  } catch {
    return null;
  }
};

export type LdapReferralError = Error & {
  dn: string;
  code: number;
  referrals: string[];
  referralSource?: "search" | "modify";
};

/**
 * Checks if an error is an LDAP Referral (code 10) without requiring `dn` to be populated.
 * Search referrals may have an empty matched DN.
 */
export const isLdapReferral = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const ldapErr = err as Error & { name?: string; code?: number };
  return ldapErr.name === "ReferralError" && ldapErr.code === 10;
};

/**
 * Type guard for a fully-formed LDAP Referral: code 10 with `dn` (string) and `referrals` (array).
 * `referrals` carries the actual target URLs from the LDAPResult, which is the primary source for determining the chase target.
 */
export const isLdapReferralError = (err: unknown): err is LdapReferralError => {
  if (!isLdapReferral(err)) return false;
  const ldapErr = err as Error & { dn?: unknown; code?: unknown; referrals?: unknown };
  return typeof ldapErr.dn === "string" && typeof ldapErr.code === "number" && Array.isArray(ldapErr.referrals);
};

const parseLdapUrl = (url: string): { protocol: string; host: string; port: number } => {
  const urlObj = new URL(url);
  const isSSL = urlObj.protocol === "ldaps:";
  const defaultPort = isSSL ? 636 : 389;

  return {
    protocol: urlObj.protocol.replace(":", ""),
    host: urlObj.hostname,
    port: urlObj.port ? parseInt(urlObj.port, 10) : defaultPort
  };
};

const constructLdapUrl = (protocol: string, host: string, port: number): string => {
  return `${protocol}://${host}:${port}`;
};

/**
 * Normalizes an LDAP URL to always include an explicit port.
 * e.g. "ldaps://dc1.test.com" → "ldaps://dc1.test.com:636"
 */
export const normalizeLdapUrl = (url: string): string => {
  const { protocol, host, port } = parseLdapUrl(url);
  return constructLdapUrl(protocol, host, port);
};

/**
 * Extracts the root domain (last two labels) from a hostname.
 * e.g. "dc1.test.com" → "test.com", "americas.vaultix.local" → "vaultix.local"
 * Returns null for IPs or single-label hostnames where a suffix check isn't meaningful.
 */
const getRootDomain = (hostname: string): string | null => {
  const parts = hostname.split(".");
  if (parts.length < 2) return null;
  if (isIP(hostname) !== 0) return null;
  return parts.slice(-2).join(".").toLowerCase();
};

/**
 * Constructs a new LDAP URL targeting a different domain/host,
 * preserving the protocol and port from the original URL.
 *
 * Validates that the target domain shares the same root domain as the original
 * host to prevent credential forwarding to attacker-controlled servers via
 * a crafted referral response.
 */
export const buildReferralUrl = (originalUrl: string, targetDomain: string): string => {
  const { protocol, host, port } = parseLdapUrl(originalUrl);

  if (isIP(targetDomain) !== 0) {
    throw new Error(
      `Referral target '${targetDomain}' is an IP address — legitimate AD referrals use FQDNs. Refusing to forward credentials`
    );
  }

  const originalRoot = getRootDomain(host);
  const targetRoot = getRootDomain(targetDomain);

  if (!originalRoot) {
    throw new Error(
      `Cannot validate referral domain boundary — original LDAP URL '${host}' is not a FQDN. Refusing to forward credentials to '${targetDomain}'`
    );
  } else if (!targetRoot || originalRoot !== targetRoot) {
    throw new Error(
      `Referral domain '${targetDomain}' is outside the trust boundary of '${host}' — refusing to forward credentials`
    );
  }

  return constructLdapUrl(protocol, targetDomain, port);
};

export const getLdapConnectionListItem = () => {
  return {
    name: "LDAP" as const,
    app: AppConnection.LDAP as const,
    methods: Object.values(LdapConnectionMethod) as [LdapConnectionMethod.SimpleBind]
  };
};

export const getLdapConnectionClient = async ({
  url,
  dn,
  password,
  sslCertificate,
  sslRejectUnauthorized = true
}: TLdapConnectionConfig["credentials"]) => {
  await blockLocalAndPrivateIpAddresses(url, false);

  const isSSL = url.startsWith("ldaps");

  const client = new Client({
    url,
    timeout: LDAP_TIMEOUT,
    connectTimeout: LDAP_TIMEOUT,
    tlsOptions: isSSL
      ? {
          rejectUnauthorized: sslRejectUnauthorized,
          ca: sslCertificate ? [sslCertificate] : undefined
        }
      : undefined
  });

  try {
    await client.bind(dn, password);
    return client;
  } catch (error) {
    await client.unbind();
    throw error;
  }
};

export const executeWithPotentialGateway = async <T>(
  config: TLdapConnectionConfig,
  gatewayV2Service: Pick<TGatewayV2ServiceFactory, "getPlatformConnectionDetailsByGatewayId">,
  operation: (client: Client) => Promise<T>,
  gatewayPoolService?: Pick<TGatewayPoolServiceFactory, "resolveEffectiveGatewayId">
): Promise<T> => {
  const { gatewayId: directGatewayId, gatewayPoolId, credentials } = config;
  const { protocol, host, port } = parseLdapUrl(credentials.url);
  const appCfg = getConfig();

  if (gatewayPoolId && !gatewayPoolService) {
    throw new BadRequestError({
      message: "Pool-backed connections require gatewayPoolService at the call site"
    });
  }
  const gatewayId =
    gatewayPoolId && gatewayPoolService
      ? await gatewayPoolService.resolveEffectiveGatewayId({ gatewayId: directGatewayId, gatewayPoolId })
      : directGatewayId;

  if (gatewayId && gatewayV2Service) {
    await blockLocalAndPrivateIpAddresses(credentials.url, true);
    const platformConnectionDetails = await gatewayV2Service.getPlatformConnectionDetailsByGatewayId({
      gatewayId,
      targetHost: host,
      targetPort: port
    });

    if (!platformConnectionDetails) {
      throw new BadRequestError({ message: "Unable to connect to gateway, no platform connection details found" });
    }

    return withGatewayV2Proxy(
      async (proxyPort) => {
        const proxyUrl = constructLdapUrl(protocol, "localhost", proxyPort);
        const isSSL = protocol === "ldaps";

        const client = new Client({
          url: proxyUrl,
          timeout: LDAP_TIMEOUT,
          connectTimeout: LDAP_TIMEOUT,
          tlsOptions: isSSL
            ? {
                rejectUnauthorized: config.credentials.sslRejectUnauthorized,
                ca: config.credentials.sslCertificate ? [config.credentials.sslCertificate] : undefined,
                servername: host,
                // bypass hostname verification for development
                ...(appCfg.isDevelopmentMode ? { checkServerIdentity: () => undefined } : {})
              }
            : undefined
        });

        try {
          await client.bind(credentials.dn, credentials.password);
          return await operation(client);
        } finally {
          await client.unbind();
        }
      },
      {
        protocol: GatewayProxyProtocol.Tcp,
        relayHost: platformConnectionDetails.relayHost,
        gateway: platformConnectionDetails.gateway,
        relay: platformConnectionDetails.relay
      }
    );
  }

  // Non-gateway path - calls getLdapConnectionClient which has validation
  const client = await getLdapConnectionClient(credentials);
  try {
    return await operation(client);
  } finally {
    await client.unbind();
  }
};

export const validateLdapConnectionCredentials = async (
  config: TLdapConnectionConfig,
  gatewayService: Pick<TGatewayServiceFactory, "fnGetGatewayClientTlsByGatewayId">,
  gatewayV2Service: Pick<TGatewayV2ServiceFactory, "getPlatformConnectionDetailsByGatewayId">
) => {
  try {
    await executeWithPotentialGateway(config, gatewayV2Service, async (client) => {
      if (!client.isConnected) {
        throw new BadRequestError({ message: "Unable to connect to LDAP server" });
      }
    });

    return config.credentials;
  } catch (error) {
    throw new BadRequestError({
      message: `Unable to validate connection: ${
        (error as Error)?.message?.replaceAll(config.credentials.password, "********************") ??
        "verify credentials"
      }`
    });
  }
};
