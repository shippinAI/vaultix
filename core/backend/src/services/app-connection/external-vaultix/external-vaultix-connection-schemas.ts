import z from "zod";

import { AppConnections } from "@app/lib/api-docs";
import { AppConnection } from "@app/services/app-connection/app-connection-enums";
import {
  BaseAppConnectionSchema,
  GenericCreateAppConnectionFieldsSchema,
  GenericUpdateAppConnectionFieldsSchema
} from "@app/services/app-connection/app-connection-schemas";

import { APP_CONNECTION_NAME_MAP } from "../app-connection-maps";
import { ExternalVaultixConnectionMethod } from "./external-vaultix-connection-enums";

export const ExternalVaultixConnectionMachineIdentityCredentialsSchema = z.object({
  instanceUrl: z
    .string()
    .trim()
    .url("Instance URL must be a valid URL")
    .min(1, "Instance URL is required")
    .max(512, "Instance URL cannot exceed 512 characters"),
  machineIdentityClientId: z
    .string()
    .trim()
    .uuid("Machine Identity Client ID must be a valid UUID")
    .min(1, "Machine Identity Client ID is required"),
  machineIdentityClientSecret: z
    .string()
    .trim()
    .min(1, "Machine Identity Client Secret is required")
    .max(512, "Machine Identity Client Secret cannot exceed 512 characters")
});

const BaseExternalVaultixConnectionSchema = BaseAppConnectionSchema.extend({
  app: z.literal(AppConnection.ExternalVaultix)
});

export const ExternalVaultixConnectionSchema = BaseExternalVaultixConnectionSchema.extend({
  method: z.literal(ExternalVaultixConnectionMethod.MachineIdentityUniversalAuth),
  credentials: ExternalVaultixConnectionMachineIdentityCredentialsSchema
});

export const SanitizedExternalVaultixConnectionSchema = z.discriminatedUnion("method", [
  BaseExternalVaultixConnectionSchema.extend({
    method: z.literal(ExternalVaultixConnectionMethod.MachineIdentityUniversalAuth),
    credentials: ExternalVaultixConnectionMachineIdentityCredentialsSchema.pick({
      instanceUrl: true,
      machineIdentityClientId: true
    })
  }).describe(
    JSON.stringify({
      title: `${APP_CONNECTION_NAME_MAP[AppConnection.ExternalVaultix]} (Machine Identity - Universal Auth)`
    })
  )
]);

export const ValidateExternalVaultixConnectionCredentialsSchema = z.discriminatedUnion("method", [
  z.object({
    method: z
      .literal(ExternalVaultixConnectionMethod.MachineIdentityUniversalAuth)
      .describe(AppConnections.CREATE(AppConnection.ExternalVaultix).method),
    credentials: ExternalVaultixConnectionMachineIdentityCredentialsSchema.describe(
      AppConnections.CREATE(AppConnection.ExternalVaultix).credentials
    )
  })
]);

export const CreateExternalVaultixConnectionSchema = ValidateExternalVaultixConnectionCredentialsSchema.and(
  GenericCreateAppConnectionFieldsSchema(AppConnection.ExternalVaultix)
);

export const UpdateExternalVaultixConnectionSchema = z
  .object({
    credentials: ExternalVaultixConnectionMachineIdentityCredentialsSchema.optional().describe(
      AppConnections.UPDATE(AppConnection.ExternalVaultix).credentials
    )
  })
  .and(GenericUpdateAppConnectionFieldsSchema(AppConnection.ExternalVaultix));

export const ExternalVaultixConnectionListItemSchema = z
  .object({
    name: z.literal("Vaultix"),
    app: z.literal(AppConnection.ExternalVaultix),
    methods: z.nativeEnum(ExternalVaultixConnectionMethod).array()
  })
  .describe(JSON.stringify({ title: APP_CONNECTION_NAME_MAP[AppConnection.ExternalVaultix] }));
