import { AppConnection } from "@app/hooks/api/appConnections/enums";
import { TRootAppConnection } from "@app/hooks/api/appConnections/types/root-connection";

export enum InfisicalConnectionMethod {
  ApiToken = "api-token"
}

export type TInfisicalConnection = TRootAppConnection & { app: AppConnection.Infisical } & {
  method: InfisicalConnectionMethod.ApiToken;
  credentials: {
    apiToken: string;
  };
};
