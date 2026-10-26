import { apiRequest } from "@app/config/request";

export type VaultixProject = {
  id: string;
  name: string;
  environments: { id: string; name: string; slug: string }[];
};
export type VaultixReference = { id: string; name: string; version: number };
export type VaultixReferencePage = {
  references: VaultixReference[];
  nextOffset: number | null;
  narration: string;
};

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 2048;
const invalid = () => new Error("Vaultix returned an unsupported response.");
const call = async (name: string, args: Record<string, unknown>) => {
  const response = await apiRequest.post<unknown>("/api/v1/vaultix/mcp", {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: { name, arguments: args }
  });
  const body = response.data;
  if (
    !record(body) ||
    !record(body.result) ||
    body.result.isError ||
    !Array.isArray(body.result.content) ||
    !record(body.result.content[0]) ||
    typeof body.result.content[0].text !== "string"
  )
    throw invalid();
  return JSON.parse(body.result.content[0].text) as unknown;
};

export const listVaultixProjects = async (): Promise<VaultixProject[]> => {
  const value = await call("vaultix.projects.list", {});
  if (!record(value) || !Array.isArray(value.projects)) throw invalid();
  return value.projects.map((project: unknown) => {
    if (
      !record(project) ||
      !text(project.id) ||
      !text(project.name) ||
      !Array.isArray(project.environments)
    )
      throw invalid();
    const environments = project.environments.map((environment: unknown) => {
      if (
        !record(environment) ||
        !text(environment.id) ||
        !text(environment.name) ||
        !text(environment.slug)
      )
        throw invalid();
      return { id: environment.id, name: environment.name, slug: environment.slug };
    });
    return { id: project.id, name: project.name, environments };
  });
};

export const listVaultixReferences = async (scope: {
  projectId: string;
  environment: string;
  secretPath: string;
  offset: number;
}): Promise<VaultixReferencePage> => {
  const value = await call("vaultix.secrets.references", { ...scope, limit: 50 });
  if (
    !record(value) ||
    !Array.isArray(value.references) ||
    value.references.length > 50 ||
    !text(value.narration) ||
    !(
      value.nextOffset === null ||
      (Number.isSafeInteger(value.nextOffset) && Number(value.nextOffset) > scope.offset)
    )
  )
    throw invalid();
  const references = value.references.map((reference: unknown) => {
    if (
      !record(reference) ||
      !text(reference.id) ||
      !text(reference.name) ||
      typeof reference.version !== "number" ||
      !Number.isSafeInteger(reference.version)
    )
      throw invalid();
    return { id: reference.id, name: reference.name, version: reference.version };
  });
  return { references, nextOffset: value.nextOffset as number | null, narration: value.narration };
};
