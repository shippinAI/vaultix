import { useQuery, UseQueryOptions } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";
import { appConnectionKeys } from "@app/hooks/api/appConnections";

import { TRemoteVaultixEnvironmentFolderTree, TRemoteVaultixProject } from "./types";

const externalVaultixConnectionKeys = {
  all: [...appConnectionKeys.all, "external-vaultix"] as const,
  listProjects: (connectionId: string) =>
    [...externalVaultixConnectionKeys.all, "projects", connectionId] as const,
  getEnvironmentFolderTree: (connectionId: string, projectId: string) =>
    [
      ...externalVaultixConnectionKeys.all,
      "environment-folder-tree",
      connectionId,
      projectId
    ] as const
};

export const useExternalVaultixConnectionListProjects = (
  connectionId: string,
  options?: Omit<
    UseQueryOptions<
      TRemoteVaultixProject[],
      unknown,
      TRemoteVaultixProject[],
      ReturnType<typeof externalVaultixConnectionKeys.listProjects>
    >,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery({
    queryKey: externalVaultixConnectionKeys.listProjects(connectionId),
    queryFn: async () => {
      const { data } = await apiRequest.get<{ projects: TRemoteVaultixProject[] }>(
        `/api/v1/app-connections/external-vaultix/${connectionId}/projects`
      );
      return data.projects;
    },
    ...options
  });
};

export const useExternalVaultixConnectionGetEnvironmentFolderTree = (
  connectionId: string,
  projectId: string,
  options?: Omit<
    UseQueryOptions<
      TRemoteVaultixEnvironmentFolderTree,
      unknown,
      TRemoteVaultixEnvironmentFolderTree,
      ReturnType<typeof externalVaultixConnectionKeys.getEnvironmentFolderTree>
    >,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery({
    queryKey: externalVaultixConnectionKeys.getEnvironmentFolderTree(connectionId, projectId),
    queryFn: async () => {
      const { data } = await apiRequest.get<TRemoteVaultixEnvironmentFolderTree>(
        `/api/v1/app-connections/external-vaultix/${connectionId}/projects/${projectId}/environment-folder-tree`
      );
      return data ?? {};
    },
    ...options
  });
};
