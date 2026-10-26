import { BadRequestError } from "@app/lib/errors";

import type { ReferenceQuery } from "./reference-service";

export const parseReferenceQuery = (input: unknown): ReferenceQuery => {
  const invalid = () =>
    new BadRequestError({ message: "Choose a project, environment, and folder. Use a page size from 1 to 100." });
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["projectId", "environment", "secretPath", "offset", "limit"].includes(key)))
    throw invalid();
  const { projectId, environment, secretPath = "/" } = value;
  if (
    typeof projectId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
  )
    throw invalid();
  if (typeof environment !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(environment)) throw invalid();
  if (
    typeof secretPath !== "string" ||
    secretPath.length > 1024 ||
    !secretPath.startsWith("/") ||
    [...secretPath].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\"
    ) ||
    secretPath.split("/").some((part) => part === "." || part === "..")
  )
    throw invalid();
  const integer = (raw: unknown, fallback: number, min: number, max: number) => {
    if (raw === undefined) return fallback;
    if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d{1,7}$/.test(raw))) throw invalid();
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalid();
    return parsed;
  };
  return {
    projectId,
    environment,
    secretPath,
    offset: integer(value.offset, 0, 0, 1000000),
    limit: integer(value.limit, 50, 1, 100)
  };
};

export const referenceTools = [
  {
    name: "vaultix.projects.list",
    description: "List apps and environments available to the authenticated actor. No secret values.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "vaultix.secrets.references",
    description:
      "List authorized secret names in one app environment and folder. No values, comments, or custom metadata. Follow nextOffset until null; a filtered page can be empty.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projectId", "environment"],
      properties: {
        projectId: { type: "string", format: "uuid" },
        environment: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9_-]+$" },
        secretPath: { type: "string", maxLength: 1024, default: "/" },
        offset: { type: "integer", minimum: 0, maximum: 1000000, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
      }
    }
  }
].map((tool) => ({
  ...tool,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}));
