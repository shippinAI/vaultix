import { getLicenseKeyConfig } from "@app/shippin/services/license/license-fns";
import { LicenseType } from "@app/shippin/services/license/license-types";
import { KeyStorePrefixes, KeyStoreTtls, TKeyStoreFactory } from "@app/keystore/keystore";
import { getConfig } from "@app/lib/config/env";
import { request } from "@app/lib/config/request";
import { CronJobName, TCronJobFactory } from "@app/lib/cron/cron-job";
import { logger } from "@app/lib/logger";

import {
  isUpdateCheckEnabled,
  isVersionNewer,
  LATEST_RELEASE_URL,
  parseSemanticVersion,
  readStableRelease,
  RELEASES_URL
} from "./update-check-fns";

type Snapshot = {
  state: "checked" | "unpublished" | "unavailable";
  checkedAt: string;
  latestVersion: string | null;
  releaseUrl: string;
};
type TUpdateCheckServiceFactoryDep = {
  cronJob: Pick<TCronJobFactory, "register">;
  keyStore: Pick<TKeyStoreFactory, "getItem" | "setItemWithExpiry">;
};
export type TUpdateCheckServiceFactory = ReturnType<typeof updateCheckServiceFactory>;

export const updateCheckServiceFactory = ({ cronJob, keyStore }: TUpdateCheckServiceFactoryDep) => {
  const appCfg = getConfig();
  const licenseKeyConfig = getLicenseKeyConfig();
  const disabled =
    appCfg.DISABLE_UPDATE_CHECK || Boolean(licenseKeyConfig.isValid && licenseKeyConfig.type === LicenseType.Offline);
  const managed = appCfg.VAULTIX_CLOUD || appCfg.isCloud;
  const current = parseSemanticVersion(appCfg.VAULTIX_PLATFORM_VERSION);
  const enabled = isUpdateCheckEnabled({
    isVaultixCloud: appCfg.VAULTIX_CLOUD,
    isCloud: appCfg.isCloud,
    isUpdateCheckDisabled: appCfg.DISABLE_UPDATE_CHECK,
    hasOfflineLicense: disabled,
    platformVersion: appCfg.VAULTIX_PLATFORM_VERSION
  });
  const cacheKey = `${KeyStorePrefixes.UpdateCheckLatestVersion}:vaultix:v1`;
  let pending: Promise<void> | undefined;
  let lastAttempt = 0;

  const readSnapshot = async (): Promise<Snapshot | null> => {
    try {
      const raw = await keyStore.getItem(cacheKey);
      if (!raw || raw.length > 2048) return null;
      const data = JSON.parse(raw) as Snapshot;
      if (
        !data ||
        !["checked", "unpublished", "unavailable"].includes(data.state) ||
        typeof data.checkedAt !== "string" ||
        !Number.isFinite(Date.parse(data.checkedAt)) ||
        Date.now() - Date.parse(data.checkedAt) > KeyStoreTtls.UpdateCheckLatestVersionInSeconds * 1000 ||
        Date.parse(data.checkedAt) > Date.now() + 60000
      )
        return null;
      if (data.state === "checked") {
        const parsed = parseSemanticVersion(data.latestVersion ?? undefined);
        if (
          !parsed ||
          parsed.prerelease ||
          typeof data.releaseUrl !== "string" ||
          ![
            `${RELEASES_URL}/tag/${data.latestVersion}`,
            `${RELEASES_URL}/tag/v${data.latestVersion}`,
            `${RELEASES_URL}/tag/V${data.latestVersion}`
          ].includes(data.releaseUrl)
        )
          return null;
      } else if (data.latestVersion !== null || data.releaseUrl !== RELEASES_URL) return null;
      return {
        state: data.state,
        checkedAt: data.checkedAt,
        latestVersion: data.latestVersion,
        releaseUrl: data.releaseUrl
      };
    } catch {
      return null;
    }
  };

  const refresh = async () => {
    if (!enabled) return;
    if (pending) return pending;
    if (Date.now() - lastAttempt < 60000) return;
    lastAttempt = Date.now();
    pending = (async () => {
      const cached = await readSnapshot();
      if (cached && Date.now() - Date.parse(cached.checkedAt) < 60000) return;
      const snapshot: Snapshot = {
        state: "unavailable",
        checkedAt: new Date().toISOString(),
        latestVersion: null,
        releaseUrl: RELEASES_URL
      };
      try {
        const response = await request.get<unknown>(LATEST_RELEASE_URL, {
          headers: { Accept: "application/vnd.github+json" },
          timeout: 5000,
          maxContentLength: 65536,
          maxRedirects: 0,
          "axios-retry": { retries: 0 },
          validateStatus: (status) => status === 200 || status === 404
        });
        if (response.status === 404) snapshot.state = "unpublished";
        else {
          const release = readStableRelease(response.data);
          if (release)
            Object.assign(snapshot, { state: "checked", latestVersion: release.version, releaseUrl: release.url });
        }
      } catch {
        logger.debug("Vaultix update check unavailable");
      }
      try {
        await keyStore.setItemWithExpiry(
          cacheKey,
          KeyStoreTtls.UpdateCheckLatestVersionInSeconds,
          JSON.stringify(snapshot)
        );
      } catch {
        logger.debug("Vaultix update status could not be saved");
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };

  const getStatus = async () => {
    const base = {
      schemaVersion: "vaultix.updates.v1" as const,
      channel: "stable" as const,
      currentVersion: appCfg.VAULTIX_PLATFORM_VERSION || "dev",
      latestVersion: null as string | null,
      checkedAt: null as string | null,
      releaseUrl: RELEASES_URL
    };
    if (managed) return { ...base, state: "managed" as const };
    if (disabled) return { ...base, state: "disabled" as const };
    if (!current) return { ...base, state: "development" as const };
    const snapshot = await readSnapshot();
    if (!snapshot) return { ...base, state: "unknown" as const };
    if (snapshot.state !== "checked") return { ...base, ...snapshot };
    const latest = parseSemanticVersion(snapshot.latestVersion ?? undefined)!;
    return {
      ...base,
      ...snapshot,
      state: isVersionNewer(latest, current) ? ("available" as const) : ("current" as const)
    };
  };

  const init = () => {
    cronJob.register({
      name: CronJobName.InstanceUpdateCheck,
      pattern: "0 0 * * 0",
      runHashTtlS: 3 * 24 * 60 * 60,
      enabled,
      handler: refresh
    });
    if (enabled) void readSnapshot().then((cached) => (cached ? undefined : refresh()));
  };
  const getAvailableUpdateVersion = async () => {
    const status = await getStatus();
    return status.state === "available" ? status.latestVersion : null;
  };
  return { init, getAvailableUpdateVersion, getStatus, refresh };
};
