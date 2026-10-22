import { getLicenseKeyConfig } from "@app/ee/services/license/license-fns";
import { LicenseType } from "@app/ee/services/license/license-types";
import { KeyStorePrefixes, KeyStoreTtls, TKeyStoreFactory } from "@app/keystore/keystore";
import { getConfig } from "@app/lib/config/env";
import { request } from "@app/lib/config/request";
import { CronJobName, TCronJobFactory } from "@app/lib/cron/cron-job";
import { logger } from "@app/lib/logger";

import { isUpdateCheckEnabled, isVersionNewer, parseSemanticVersion } from "./update-check-fns";

const updateCheckUrl = (raw?: string) => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

type TUpdateCheckServiceFactoryDep = {
  cronJob: TCronJobFactory;
  keyStore: Pick<TKeyStoreFactory, "getItem" | "setItemWithExpiry">;
};

export type TUpdateCheckServiceFactory = ReturnType<typeof updateCheckServiceFactory>;

export const updateCheckServiceFactory = ({ cronJob, keyStore }: TUpdateCheckServiceFactoryDep) => {
  const appCfg = getConfig();

  const licenseKeyConfig = getLicenseKeyConfig();

  const releaseUrl = updateCheckUrl(appCfg.VAULTIX_UPDATE_CHECK_URL);
  const isEnabled =
    Boolean(releaseUrl) &&
    isUpdateCheckEnabled({
      isVaultixCloud: appCfg.VAULTIX_CLOUD,
      isCloud: appCfg.isCloud,
      isUpdateCheckDisabled: appCfg.DISABLE_UPDATE_CHECK,
      hasOfflineLicense: Boolean(licenseKeyConfig.isValid && licenseKeyConfig.type === LicenseType.Offline),
      platformVersion: appCfg.VAULTIX_PLATFORM_VERSION
    });

  const refreshLatestVersion = async () => {
    if (!releaseUrl) return;
    try {
      const { data } = await request.get<{ tag_name?: unknown }>(releaseUrl, {
        headers: { Accept: "application/vnd.github+json" },
        timeout: 10_000
      });

      const tagName = data.tag_name;
      const latestVersion = typeof tagName === "string" ? tagName.replace(/^v/i, "") : null;
      if (!latestVersion || !parseSemanticVersion(latestVersion)) {
        logger.warn(`update-check: could not interpret latest release tag [tagName=${String(tagName)}]`);
        return;
      }

      await keyStore.setItemWithExpiry(
        KeyStorePrefixes.UpdateCheckLatestVersion,
        KeyStoreTtls.UpdateCheckLatestVersionInSeconds,
        latestVersion
      );
      logger.info(`update-check: refreshed latest platform version [latestVersion=${latestVersion}]`);
    } catch (err) {
      // best effort: air-gapped instances cannot reach GitHub, and a missed refresh
      // only delays the nudge until the next weekly fire, so failures stay quiet
      // instead of surfacing as failed cron runs
      logger.debug(err, "update-check: failed to refresh latest platform version");
    }
  };

  const init = () => {
    cronJob.register({
      name: CronJobName.InstanceUpdateCheck,
      pattern: "0 0 * * 0", // weekly on Sunday at midnight UTC
      runHashTtlS: 3 * 24 * 60 * 60,
      enabled: isEnabled,
      handler: refreshLatestVersion
    });

    if (!isEnabled) return;

    // also refresh once at boot so a fresh instance is not blind until the next Sunday fire
    void keyStore
      .getItem(KeyStorePrefixes.UpdateCheckLatestVersion)
      .then((cached) => (cached ? undefined : refreshLatestVersion()))
      .catch((err) => logger.debug(err, "update-check: failed to refresh latest platform version at boot"));
  };

  // Returns the latest release version when it is newer than the running instance, null
  // otherwise (up to date, check disabled, no data fetched yet, or keystore unavailable).
  // Never throws: the optional indicator must not be able to fail admin config reads.
  const getAvailableUpdateVersion = async () => {
    if (!isEnabled) return null;

    let latestVersion: string | null;
    try {
      latestVersion = await keyStore.getItem(KeyStorePrefixes.UpdateCheckLatestVersion);
    } catch (err) {
      logger.debug(err, "update-check: failed to read latest platform version from the keystore");
      return null;
    }
    if (!latestVersion) return null;

    const latest = parseSemanticVersion(latestVersion);
    const current = parseSemanticVersion(appCfg.VAULTIX_PLATFORM_VERSION);
    if (!latest || !current) return null;

    return isVersionNewer(latest, current) ? latestVersion : null;
  };

  return { init, getAvailableUpdateVersion };
};
