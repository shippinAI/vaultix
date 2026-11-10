import { useMemo } from "react";
import { AxiosError } from "axios";

import { useExternalVaultixConnectionListProjects } from "@app/hooks/api/appConnections/external-vaultix";
import { useGetDopplerProjects, useListImportProviders } from "@app/hooks/api/migration";
import type { TImportProviderRuntime } from "@app/hooks/api/migration/types";

import { IMPORT_PROVIDER_ORDER } from "./mcpl-manifest";
import type { ProviderCardModel, ProviderSourceState } from "./ProviderImportStudio";

export const apiErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    return data?.message || data?.error || error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
};

const toSourceState = (
  runtime: TImportProviderRuntime | undefined,
  query: { isPending: boolean; isError: boolean; error: unknown; data?: unknown[] }
): ProviderSourceState => {
  if (!runtime?.connections.length) return { state: "none" };
  if (query.isError)
    return { state: "error", message: apiErrorMessage(query.error, "The provider didn't answer.") };
  if (query.isPending || !query.data) return { state: "loading" };
  return { state: "ready", projectCount: query.data.length };
};

// Provider cards from the server's runtime: real connections, and a live read of the first one.
export const useProviderImportRuntime = (projectId?: string) => {
  const providersQuery = useListImportProviders(projectId);
  const runtime = providersQuery.data;
  const byProvider = useMemo(
    () => new Map((runtime ?? []).map((entry) => [entry.provider, entry])),
    [runtime]
  );

  const doppler = byProvider.get("doppler");
  const instance = byProvider.get("external-vaultix");
  const dopplerProjects = useGetDopplerProjects(doppler?.connections[0]?.id);
  const instanceProjects = useExternalVaultixConnectionListProjects(
    instance?.connections[0]?.id ?? "",
    { enabled: Boolean(instance?.connections[0]?.id), retry: false }
  );

  const cards = useMemo<ProviderCardModel[]>(
    () =>
      IMPORT_PROVIDER_ORDER.flatMap((provider) => {
        const entry = byProvider.get(provider);
        if (!entry) return [];
        const query = provider === "doppler" ? dopplerProjects : instanceProjects;
        return [{ runtime: entry, source: toSourceState(entry, query) }];
      }),
    [byProvider, dopplerProjects, instanceProjects]
  );

  return {
    runtime,
    cards,
    isLoading: providersQuery.isPending,
    loadError: providersQuery.isError
      ? apiErrorMessage(providersQuery.error, "Couldn't load import providers.")
      : null
  };
};
