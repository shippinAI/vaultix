import { Knex } from "knex";

import { LEGACY_TABLE_RENAMES } from "./table-namespaces";

type TRenameLogger = { info: (message: string) => void };

type TRelation = { relname: string; parent: string | null };

const MAX_IDENTIFIER = 63;

// Table names inside function bodies are rewritten only where SQL names a relation.
const bodyPattern = (legacy: string) =>
  new RegExp(`(\\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+)${legacy}\\b|\\b${legacy}(%ROWTYPE)`, "gi");

const rewriteBody = (definition: string, renames: ReadonlyArray<readonly [string, string]>) =>
  renames.reduce(
    (text, [legacy, current]) =>
      text.replace(bodyPattern(legacy), (match, keyword: string | undefined, rowtype: string | undefined) =>
        keyword ? `${keyword}${current}` : `${current}${rowtype}`
      ),
    definition
  );

const moveTables = async (db: Knex, pairs: ReadonlyArray<readonly [string, string]>, logger?: TRenameLogger) =>
  db.transaction(async (tx) => {
    const { rows } = await tx.raw<{ rows: TRelation[] }>(`
      SELECT c.relname, p.relname AS parent
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = current_schema()
      LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
      LEFT JOIN pg_class p ON p.oid = i.inhparent
      WHERE c.relkind IN ('r', 'p')
    `);
    const existing = new Set(rows.map((row) => row.relname));
    const renamed: Array<readonly [string, string]> = [];

    for (const [legacy, current] of pairs) {
      if (existing.has(legacy)) {
        if (existing.has(current)) {
          throw new Error(`Both ${legacy} and ${current} exist. Resolve the duplicate before upgrading.`);
        }
        // eslint-disable-next-line no-await-in-loop
        await tx.raw("ALTER TABLE ?? RENAME TO ??", [legacy, current]);
        renamed.push([legacy, current]);
        // knex names a primary key <table>_pkey from the current table name, so a fresh store has
        // the new spelling; an automatically named key follows its table here to match it.
        const legacyKey = `${legacy}_pkey`.slice(0, MAX_IDENTIFIER);
        // eslint-disable-next-line no-await-in-loop
        const { rows: keys } = await tx.raw<{ rows: Array<{ conname: string }> }>(
          "SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'p' AND conname = ?",
          [current, legacyKey]
        );
        if (keys.length) {
          // eslint-disable-next-line no-await-in-loop
          await tx.raw("ALTER TABLE ?? RENAME CONSTRAINT ?? TO ??", [
            current,
            legacyKey,
            `${current}_pkey`.slice(0, MAX_IDENTIFIER)
          ]);
        }
        for (const child of rows.filter((row) => row.parent === legacy && row.relname.startsWith(`${legacy}_`))) {
          const next = `${current}${child.relname.slice(legacy.length)}`;
          if (next.length > MAX_IDENTIFIER)
            throw new Error(`Partition name ${next} exceeds ${MAX_IDENTIFIER} characters`);
          // eslint-disable-next-line no-await-in-loop
          await tx.raw("ALTER TABLE ?? RENAME TO ??", [child.relname, next]);
        }
      }
    }
    if (!renamed.length) return { renamed: 0, functions: 0 };

    const { rows: functions } = await tx.raw<{ rows: Array<{ definition: string }> }>(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = current_schema()
      WHERE p.prokind = 'f'
    `);
    let recreated = 0;
    for (const { definition } of functions) {
      const next = rewriteBody(definition, renamed);
      if (next !== definition) {
        // eslint-disable-next-line no-await-in-loop
        await tx.raw(next);
        recreated += 1;
      }
    }
    logger?.info(`Renamed ${renamed.length} tables and recreated ${recreated} functions that name them.`);
    return { renamed: renamed.length, functions: recreated };
  });

/**
 * Moves an inherited store onto its vx_ table names (docs/0119). One transaction. Tables already
 * on their vx_ name, or absent, are left alone, so it is safe to run on every start. Rows,
 * columns, indexes, constraints and triggers move with each table; partitions are renamed with
 * their parent, and functions whose bodies name a renamed table are recreated with the new name.
 *
 * Before pending migrations, only TableName ("enum") tables move, because every migration names
 * them through TableName. Tables that historical raw-SQL migrations create under their inherited
 * names ("raw") move in the namespace migration itself, after those migrations have run.
 */
export const renameLegacyTables = (db: Knex, logger?: TRenameLogger, scope: "enum" | "all" = "enum") =>
  moveTables(
    db,
    LEGACY_TABLE_RENAMES.filter(([, , source]) => scope === "all" || source === "enum").map(
      ([legacy, current]) => [legacy, current] as const
    ),
    logger
  );

// The reverse, for rolling the namespace migration back.
export const restoreLegacyTables = (db: Knex, logger?: TRenameLogger) =>
  moveTables(
    db,
    LEGACY_TABLE_RENAMES.map(([legacy, current]) => [current, legacy] as const),
    logger
  );
