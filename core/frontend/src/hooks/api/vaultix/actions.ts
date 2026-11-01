import { apiRequest } from "@app/config/request";

import { createReferenceActions, readToolData } from "./reference-contract";

export type { VaultixProject, VaultixReference, VaultixReferencePage } from "./reference-contract";

export const referenceActions = createReferenceActions(async (name, args) => {
  const response = await apiRequest.post<unknown>("/api/v1/vaultix/mcp", {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: { name, arguments: args }
  });
  return readToolData(response.data);
});
export const listVaultixProjects = referenceActions.listProjects;
export const listVaultixReferences = referenceActions.listReferences;
