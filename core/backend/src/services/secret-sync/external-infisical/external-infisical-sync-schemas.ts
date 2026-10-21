import { z } from "zod";

import { SecretSyncs } from "@app/lib/api-docs";
import { AppConnection } from "@app/services/app-connection/app-connection-enums";
import { SecretSync } from "@app/services/secret-sync/secret-sync-enums";
import {
  BaseSecretSyncSchema,
  GenericCreateSecretSyncFieldsSchema,
  GenericUpdateSecretSyncFieldsSchema
} from "@app/services/secret-sync/secret-sync-schemas";
import { TSyncOptionsConfig } from "@app/services/secret-sync/secret-sync-types";

import { SECRET_SYNC_NAME_MAP } from "../secret-sync-maps";

const ExternalVaultixSyncDestinationConfigSchema = z.object({
  projectId: z
    .string()
    .trim()
    .min(1, "Project ID is required")
    .describe(SecretSyncs.DESTINATION_CONFIG.EXTERNAL_INFISICAL.projectId),
  environment: z
    .string()
    .trim()
    .min(1, "Environment slug is required")
    .describe(SecretSyncs.DESTINATION_CONFIG.EXTERNAL_INFISICAL.environment),
  secretPath: z
    .string()
    .trim()
    .min(1, "Secret path is required")
    .describe(SecretSyncs.DESTINATION_CONFIG.EXTERNAL_INFISICAL.secretPath)
});

const ExternalVaultixSyncOptionsConfig: TSyncOptionsConfig = {
  canImportSecrets: true,
  canRemoveSecretsOnDeletion: true,
  supportsKeySchema: false
};

export const ExternalVaultixSyncSchema = BaseSecretSyncSchema(
  SecretSync.ExternalVaultix,
  ExternalVaultixSyncOptionsConfig
)
  .extend({
    destination: z.literal(SecretSync.ExternalVaultix),
    destinationConfig: ExternalVaultixSyncDestinationConfigSchema
  })
  .describe(JSON.stringify({ title: SECRET_SYNC_NAME_MAP[SecretSync.ExternalVaultix] }));

export const CreateExternalVaultixSyncSchema = GenericCreateSecretSyncFieldsSchema(
  SecretSync.ExternalVaultix,
  ExternalVaultixSyncOptionsConfig,
  z.object({})
).extend({
  destinationConfig: ExternalVaultixSyncDestinationConfigSchema
});

export const UpdateExternalVaultixSyncSchema = GenericUpdateSecretSyncFieldsSchema(
  SecretSync.ExternalVaultix,
  ExternalVaultixSyncOptionsConfig,
  z.object({})
).extend({
  destinationConfig: ExternalVaultixSyncDestinationConfigSchema.optional()
});

export const ExternalVaultixSyncListItemSchema = z
  .object({
    name: z.literal("Vaultix"),
    connection: z.literal(AppConnection.ExternalVaultix),
    destination: z.literal(SecretSync.ExternalVaultix),
    canImportSecrets: z.literal(true),
    canRemoveSecretsOnDeletion: z.literal(true),
    supportsKeySchema: z.literal(false)
  })
  .describe(JSON.stringify({ title: SECRET_SYNC_NAME_MAP[SecretSync.ExternalVaultix] }));
