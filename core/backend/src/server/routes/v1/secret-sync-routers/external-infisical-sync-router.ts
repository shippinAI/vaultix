import {
  CreateExternalVaultixSyncSchema,
  ExternalVaultixSyncSchema,
  TExternalVaultixSync,
  TExternalVaultixSyncInput,
  UpdateExternalVaultixSyncSchema
} from "@app/services/secret-sync/external-infisical";
import { SecretSync } from "@app/services/secret-sync/secret-sync-enums";

import { registerSyncSecretsEndpoints } from "./secret-sync-endpoints";

export const registerExternalVaultixSyncRouter = async (server: FastifyZodProvider) =>
  registerSyncSecretsEndpoints<TExternalVaultixSync, TExternalVaultixSyncInput>({
    destination: SecretSync.ExternalVaultix,
    server,
    responseSchema: ExternalVaultixSyncSchema,
    createSchema: CreateExternalVaultixSyncSchema,
    updateSchema: UpdateExternalVaultixSyncSchema
  });
