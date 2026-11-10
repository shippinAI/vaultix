import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";
import { dashboardKeys } from "@app/hooks/api/dashboard/queries";
import { secretKeys } from "@app/hooks/api/secrets/queries";

import { projectKeys } from "../projects";
import {
  ExternalMigrationImportStatus,
  TImportVaultSecretsDTO,
  TProviderImportResult,
  TProviderImportReview,
  TProviderImportSpec
} from "./types";

export const useImportEnvKey = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, decryptionKey }: { file: File; decryptionKey: string }) => {
      const formData = new FormData();

      formData.append("decryptionKey", decryptionKey);
      formData.append("file", file);

      try {
        const response = await apiRequest.post("/api/v3/external-migration/env-key/", formData, {
          headers: {
            "Content-Type": "multipart/form-data"
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / (progressEvent?.total || 1)
            );
            console.log(`Upload Progress: ${percentCompleted}%`);
          }
        });

        console.log("Upload successful:", response.data);
      } catch (error) {
        console.error("Upload failed:", error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.getAllUserProjects()
      });
    }
  });
};

export const useImportVault = () => {
  return useMutation({
    mutationFn: async ({
      vaultAccessToken,
      vaultNamespace,
      vaultUrl,
      mappingType,
      gatewayId
    }: {
      vaultAccessToken: string;
      vaultNamespace?: string;
      vaultUrl: string;
      mappingType: string;
      gatewayId?: string;
    }) => {
      await apiRequest.post("/api/v3/external-migration/vault/", {
        vaultAccessToken,
        vaultNamespace,
        vaultUrl,
        mappingType,
        gatewayId
      });
    }
  });
};

export const useImportVaultSecrets = () => {
  const queryClient = useQueryClient();

  return useMutation<{ status: ExternalMigrationImportStatus }, object, TImportVaultSecretsDTO>({
    mutationFn: async (dto) => {
      const { data } = await apiRequest.post<{ status: ExternalMigrationImportStatus }>(
        "/api/v3/external-migration/vault/import-secrets",
        dto
      );
      return data;
    },
    onSuccess: (_, { projectId, environment, secretPath }) => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all() });
      queryClient.invalidateQueries({
        queryKey: secretKeys.getProjectSecret({
          projectId,
          environment,
          secretPath
        })
      });
    }
  });
};

// Review reads the source on the server and returns key names, counts and policy state.
export const useReviewProviderImport = () =>
  useMutation<TProviderImportReview, Error, TProviderImportSpec>({
    mutationFn: async ({ provider, ...spec }) => {
      const { data } = await apiRequest.post<TProviderImportReview>(
        `/api/v3/external-migration/providers/${provider}/review`,
        spec
      );
      return data;
    }
  });

// Writes exactly the approved keys, or opens a change request when the folder has a policy.
export const useImportProviderSecrets = () => {
  const queryClient = useQueryClient();

  return useMutation<TProviderImportResult, Error, TProviderImportSpec & { keys: string[] }>({
    mutationFn: async ({ provider, ...body }) => {
      const { data } = await apiRequest.post<TProviderImportResult>(
        `/api/v3/external-migration/providers/${provider}/import`,
        body
      );
      return data;
    },
    onSuccess: (_, { target }) => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all() });
      queryClient.invalidateQueries({
        queryKey: secretKeys.getProjectSecret({
          projectId: target.projectId,
          environment: target.environment,
          secretPath: target.secretPath
        })
      });
    }
  });
};
