import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

export const vaultixReleases = "https://github.com/shippinAI/vaultix/releases";
const queryKey = ["vaultix", "updates"];
export const updateMessages = {
  available: "A newer stable Vaultix release is available.",
  current: "This version is at or ahead of the latest stable release.",
  unknown: "Update status is not available yet. Check for updates to try again.",
  unavailable:
    "The release service could not be reached or returned an invalid response. Try again later.",
  unpublished: "No public stable Vaultix release was found.",
  development: "This is a development build. It cannot be compared with published releases.",
  disabled: "External update checks are disabled for this instance.",
  managed: "Your service operator manages Vaultix updates."
};
export type VaultixUpdateStatus = {
  schemaVersion: "vaultix.updates.v1";
  state: keyof typeof updateMessages;
  channel: "stable";
  currentVersion: string;
  latestVersion: string | null;
  checkedAt: string | null;
  releaseUrl: string;
};

export const readUpdateStatus = (value: unknown): VaultixUpdateStatus => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Update status is unavailable.");
  const data = value as VaultixUpdateStatus;
  if (
    data.schemaVersion !== "vaultix.updates.v1" ||
    data.channel !== "stable" ||
    !Object.prototype.hasOwnProperty.call(updateMessages, data.state) ||
    typeof data.currentVersion !== "string" ||
    !data.currentVersion ||
    data.currentVersion.length > 128 ||
    (data.latestVersion !== null &&
      (typeof data.latestVersion !== "string" ||
        data.latestVersion.length > 128 ||
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
          data.latestVersion
        ))) ||
    (data.checkedAt !== null &&
      (typeof data.checkedAt !== "string" || !Number.isFinite(Date.parse(data.checkedAt)))) ||
    (data.releaseUrl !== vaultixReleases &&
      !(
        data.latestVersion &&
        [
          `${vaultixReleases}/tag/${data.latestVersion}`,
          `${vaultixReleases}/tag/v${data.latestVersion}`,
          `${vaultixReleases}/tag/V${data.latestVersion}`
        ].includes(data.releaseUrl)
      )) ||
    (["available", "current"].includes(data.state) && !data.latestVersion)
  )
    throw new Error("Update status is unavailable.");
  return data;
};

export const useVaultixUpdates = () =>
  useQuery({
    queryKey,
    queryFn: async () =>
      readUpdateStatus((await apiRequest.get<unknown>("/api/v1/vaultix/updates")).data),
    staleTime: 5 * 60_000,
    retry: false,
    refetchInterval: 60 * 60_000,
    refetchOnWindowFocus: true
  });

export const useCheckVaultixUpdates = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        return readUpdateStatus(
          (await apiRequest.post<unknown>("/api/v1/vaultix/updates/check", {})).data
        );
      } catch {
        // The dialog owns failure and retry feedback. Keep transport diagnostics local
        // instead of also triggering the shared Axios mutation notification.
        throw new Error("Vaultix update status could not be refreshed.");
      }
    },
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
    }
  });
};
