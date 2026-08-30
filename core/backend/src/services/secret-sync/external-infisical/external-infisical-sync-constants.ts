import { AppConnection } from "@app/services/app-connection/app-connection-enums";
import { SecretSync } from "@app/services/secret-sync/secret-sync-enums";
import { TSecretSyncListItem } from "@app/services/secret-sync/secret-sync-types";

export const EXTERNAL_VAULTIX_SYNC_LIST_OPTION: TSecretSyncListItem = {
  name: "Vaultix",
  destination: SecretSync.ExternalVaultix,
  connection: AppConnection.ExternalVaultix,
  canImportSecrets: true,
  canRemoveSecretsOnDeletion: true,
  supportsKeySchema: false
};
