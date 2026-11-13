import { createPrivateKey, X509Certificate } from "node:crypto";
import { isIP } from "node:net";

import { Client, FilterParser } from "ldapts";

import { BadRequestError } from "@app/lib/errors";
import { directoryCommonName } from "@app/lib/ldap/directory";
import { logger } from "@app/lib/logger";

import { TLDAPConfig, TTestLDAPConfigDTO } from "./ldap-config-types";

export const isValidLdapFilter = (filter: string) => {
  try {
    FilterParser.parseString(filter);
    return true;
  } catch (error) {
    logger.error(error, "Invalid LDAP filter");
    return false;
  }
};

type TLdapTlsConfigInput = Pick<TLDAPConfig, "url" | "caCert" | "clientCertificate" | "clientKeyCertificate">;

export const buildLdapTlsOptions = (cfg: TLdapTlsConfigInput) => {
  const tlsOptions: { ca?: string[]; cert?: string; key?: string; servername?: string } = {};

  if (cfg.caCert) {
    try {
      // eslint-disable-next-line no-new
      new X509Certificate(cfg.caCert);
    } catch {
      throw new BadRequestError({
        message: "Invalid CA Certificate. Expected a PEM-encoded X.509 certificate."
      });
    }
    tlsOptions.ca = [cfg.caCert];
  }
  if (cfg.clientCertificate) {
    try {
      // eslint-disable-next-line no-new
      new X509Certificate(cfg.clientCertificate);
    } catch {
      throw new BadRequestError({
        message: "Invalid Client Certificate. Expected a PEM-encoded X.509 certificate."
      });
    }
    tlsOptions.cert = cfg.clientCertificate;
  }
  if (cfg.clientKeyCertificate) {
    try {
      createPrivateKey(cfg.clientKeyCertificate);
    } catch {
      throw new BadRequestError({
        message: "Invalid Client Private Key. Expected a PEM-encoded private key."
      });
    }
    tlsOptions.key = cfg.clientKeyCertificate;
  }

  if (Object.keys(tlsOptions).length === 0) return undefined;

  // Secure LDAP providers use SNI to select the client-certificate tenant.
  if (cfg.clientCertificate || cfg.clientKeyCertificate) {
    try {
      const { hostname } = new URL(cfg.url);
      if (!isIP(hostname)) tlsOptions.servername = hostname;
    } catch {
      // Malformed URL — connection itself will surface the error.
    }
  }

  return tlsOptions;
};

export const testLDAPConfig = async (ldapConfig: TTestLDAPConfigDTO): Promise<boolean> => {
  const client = new Client({
    url: ldapConfig.url,
    connectTimeout: 15_000,
    timeout: 15_000,
    tlsOptions: buildLdapTlsOptions(ldapConfig)
  });
  try {
    await client.bind(ldapConfig.bindDN, ldapConfig.bindPass);
    return true;
  } catch (error) {
    logger.error(error, "LDAP configuration bind failed");
    return false;
  } finally {
    await client.unbind();
  }
};

export const extractCnFromDn = directoryCommonName;

export const searchGroups = async (
  ldapConfig: TLDAPConfig,
  filter: string,
  base: string
): Promise<{ dn: string; cn: string }[]> => {
  const client = new Client({
    url: ldapConfig.url,
    connectTimeout: 15_000,
    timeout: 15_000,
    tlsOptions: buildLdapTlsOptions(ldapConfig)
  });
  try {
    await client.bind(ldapConfig.bindDN, ldapConfig.bindPass);
    const { searchEntries } = await client.search(base, { filter, scope: "sub", paged: { pageSize: 500 } });
    return searchEntries.flatMap(({ dn }) => {
      const cn = extractCnFromDn(dn);
      return cn === undefined ? [] : [{ dn, cn }];
    });
  } finally {
    await client.unbind();
  }
};
