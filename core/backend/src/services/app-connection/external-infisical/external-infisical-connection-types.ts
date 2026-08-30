import z from "zod";

import { DiscriminativePick } from "@app/lib/types";

import { AppConnection } from "../app-connection-enums";
import {
  CreateExternalVaultixConnectionSchema,
  ExternalVaultixConnectionSchema,
  ValidateExternalVaultixConnectionCredentialsSchema
} from "./external-infisical-connection-schemas";

export type TExternalVaultixConnection = z.infer<typeof ExternalVaultixConnectionSchema>;

export type TExternalVaultixConnectionInput = z.infer<typeof CreateExternalVaultixConnectionSchema> & {
  app: AppConnection.ExternalVaultix;
};

export type TValidateExternalVaultixConnectionCredentialsSchema =
  typeof ValidateExternalVaultixConnectionCredentialsSchema;

export type TExternalVaultixConnectionConfig = DiscriminativePick<
  TExternalVaultixConnectionInput,
  "method" | "app" | "credentials"
> & {
  orgId: string;
};
