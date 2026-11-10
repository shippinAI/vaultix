import { LEGACY_TABLE_RENAMES } from "./table-namespaces";

// Junction tables name their foreign-key columns after the tables they join. Those column
// names were set before the vx_ table names (docs/0119) and stay as they are: renaming a table
// does not rename its columns, and fresh stores must have the same columns as upgraded ones.
export const JunctionColumn = {
  Secret: "secretsId",
  SecretV2: "secrets_v2Id",
  SecretVersion: "secret_versionsId",
  SecretVersionV2: "secret_versions_v2Id",
  SecretTag: "secret_tagsId"
} as const;

const legacyByCurrent = new Map(LEGACY_TABLE_RENAMES.map(([legacy, current]) => [current, legacy]));

// The foreign-key column createJunctionTable gives a joined table: its inherited name + "Id".
export const junctionColumnFor = (table: string) => `${legacyByCurrent.get(table) ?? table}Id`;
