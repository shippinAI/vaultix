import { AppConnection } from "@app/hooks/api/appConnections/enums";
import { TRootAppConnection } from "@app/hooks/api/appConnections/types/root-connection";

export enum ExternalVaultixConnectionMethod {
  MachineIdentityUniversalAuth = "machine-identity-universal-auth"
}

export type TExternalVaultixConnection = TRootAppConnection & {
  app: AppConnection.ExternalVaultix;
} & {
  method: ExternalVaultixConnectionMethod.MachineIdentityUniversalAuth;
  credentials: {
    instanceUrl: string;
    machineIdentityClientId: string;
  };
};
