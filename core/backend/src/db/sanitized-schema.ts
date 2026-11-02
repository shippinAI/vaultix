import { readFile } from "node:fs/promises";

import { FAILSAFE_SCHEMA, load } from "js-yaml";
import { Knex } from "knex";
import path from "path";
import { Logger } from "pino";

import { PgSqlLock } from "@app/keystore/keystore";

import { buildAnalyticsGrantStatements, buildAnalyticsViewStatements } from "./analytics-views";

const SANITIZED_SCHEMA = "analytics";

type TArgs = {
  db: Knex;
  logger: Logger;
};

export const acquireSanitizedSchemaLock = async ({ db, logger }: TArgs): Promise<boolean> => {
  const res = await db.raw<{ rows: { lock_acquired: boolean }[] }>(
    "SELECT pg_try_advisory_xact_lock(?) as lock_acquired",
    [PgSqlLock.SanitizedSchemaGeneration]
  );
  if (res?.rows[0]?.lock_acquired) {
    logger.info("Acquired sanitized schema generation lock");
  } else {
    logger.info("Skipping sanitized schema generation: another instance is currently generating the schema");
  }
  return res?.rows[0]?.lock_acquired;
};

export const dropSanitizedSchema = async ({ db, logger }: TArgs): Promise<void> => {
  await db.raw(`DROP SCHEMA IF EXISTS "${SANITIZED_SCHEMA}" CASCADE`);
  logger.info("Dropped existing sanitized schema");
};

export const createSanitizedSchema = async ({ db, logger }: TArgs): Promise<void> => {
  const content = await readFile(path.join(__dirname, "sanitized-schema.yaml"), "utf8");
  if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new Error("Analytics configuration exceeds its size limit.");
  const config: unknown = load(content, { schema: FAILSAFE_SCHEMA });
  const statements = buildAnalyticsViewStatements(config, SANITIZED_SCHEMA);
  await db.raw(statements.join("\n"));
  logger.info("Created sanitized schema and views");
};

type TGrantArgs = TArgs & {
  role: string;
};

export const grantSanitizedSchemaAccess = async ({ db, logger, role }: TGrantArgs): Promise<void> => {
  await db.raw(buildAnalyticsGrantStatements(SANITIZED_SCHEMA, role).join("\n"));
  logger.info(`Granted read access on sanitized schema to role: ${role}`);
};
