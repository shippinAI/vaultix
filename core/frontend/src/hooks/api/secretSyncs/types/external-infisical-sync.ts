import { AppConnection } from "@app/hooks/api/appConnections/enums";
import { SecretSync } from "@app/hooks/api/secretSyncs";
import { TRootSecretSync } from "@app/hooks/api/secretSyncs/types/root-sync";

export type TExternalVaultixSync = TRootSecretSync & {
  destination: SecretSync.ExternalVaultix;
  destinationConfig: {
    projectId: string;
    environment: string;
    secretPath: string;
  };
  connection: {
    app: AppConnection.ExternalVaultix;
    name: string;
    id: string;
  };
};
