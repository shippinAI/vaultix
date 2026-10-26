import z from "zod";

import { TExternalVaultixConnection } from "@app/services/app-connection/external-vaultix";

import {
  CreateExternalVaultixSyncSchema,
  ExternalVaultixSyncListItemSchema,
  ExternalVaultixSyncSchema
} from "./external-vaultix-sync-schemas";

export type TExternalVaultixSyncListItem = z.infer<typeof ExternalVaultixSyncListItemSchema>;

export type TExternalVaultixSync = z.infer<typeof ExternalVaultixSyncSchema>;

export type TExternalVaultixSyncInput = z.infer<typeof CreateExternalVaultixSyncSchema>;

export type TExternalVaultixSyncWithCredentials = TExternalVaultixSync & {
  connection: TExternalVaultixConnection;
};
