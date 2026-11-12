import { Knex } from "knex";

import { makeObjectName, MAX_IDENTIFIER } from "./table-namespace-names";
import { LEGACY_TABLE_RENAMES, LITERAL_OBJECT_NAMES } from "./table-namespaces";

type TRenameLogger = { info: (message: string) => void };
type TRelation = { relname: string; parent: string | null };
type TPair = readonly [from: string, to: string];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Where a function body names a relation: after FROM/JOIN/INTO/UPDATE/TABLE/REFERENCES/USING/ONLY
// (optionally public.-qualified or quoted), as name.column or "name"."column", and in %ROWTYPE.
const rewriteBody = (definition: string, pairs: ReadonlyArray<TPair>) =>
  pairs.reduce((text, [from, to]) => {
    const name = escape(from);
    return text
      .replace(
        new RegExp(
          `(\\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|USING|ONLY)\\s+(?:public\\.)?"?)${name}("?)(?![A-Za-z0-9_])`,
          "gi"
        ),
        `$1${to}$2`
      )
      .replace(new RegExp(`(?<![A-Za-z0-9_."$])${name}(%ROWTYPE|\\.(?=["A-Za-z_]))`, "gi"), `${to}$1`)
      .replace(new RegExp(`"${name}"(\\.)`, "g"), `"${to}"$1`);
  }, definition);

// PostgreSQL-generated names that start with the table's name. knex's own names (_unique, _index,
// _foreign) follow the inherited table name instead and are left alone (table-namespace-index-names),
// and so are names a historical migration spells out, which read the same on a fresh store.
const GENERATED_CONSTRAINT = /_((?:pkey|key|fkey|check|excl)\d*)$/;
const GENERATED_INDEX = /_(idx\d*)$/;
const GENERATED_SEQUENCE = /_(seq\d*)$/;

const currentByLegacy = new Map(LEGACY_TABLE_RENAMES.map(([legacy, current]) => [legacy, current]));
const legacyLongestFirst = [...currentByLegacy.keys()].sort((a, b) => b.length - a.length);

// The inherited name a generated name was built from: the table's own or, for a table an old
// migration renamed, the name it carried then. A fresh store has the vx_ form of that name.
const nameSource = (name: string, from: string, to: string): TPair | undefined => {
  if (name.startsWith(`${from}_`)) return [from, to];
  const legacy = legacyLongestFirst.find((candidate) => name.startsWith(`${candidate}_`));
  return legacy ? [legacy, currentByLegacy.get(legacy) as string] : undefined;
};

const followName = (name: string, table: string, renamed: string, pattern: RegExp) => {
  const label = name.match(pattern)?.[1];
  const source = nameSource(name, table, renamed);
  if (!label || !source || LITERAL_OBJECT_NAMES.has(name)) return undefined;
  // A name cut at 63 characters cannot be reconstructed, so it keeps its spelling.
  if (name.length >= MAX_IDENTIFIER) return undefined;
  const [from, to] = source;
  const middle = name.slice(from.length + 1, name.length - label.length - 1);
  const next = makeObjectName(to, middle || undefined, label);
  return next === name ? undefined : next;
};

// The generated constraint, index, sequence and updatedAt trigger names of a renamed table follow
// it, so an upgraded store has the names a fresh store gets.
const followGeneratedNames = async (tx: Knex, from: string, to: string) => {
  const { rows: constraints } = await tx.raw<{ rows: Array<{ conname: string }> }>(
    "SELECT conname FROM pg_constraint WHERE conrelid = quote_ident(?)::regclass",
    [to]
  );
  for (const { conname } of constraints) {
    const next = followName(conname, from, to, GENERATED_CONSTRAINT);
    // eslint-disable-next-line no-await-in-loop
    if (next) await tx.raw("ALTER TABLE ?? RENAME CONSTRAINT ?? TO ??", [to, conname, next]);
  }
  // Indexes behind this table's own key constraints were renamed with the constraint above.
  const { rows: indexes } = await tx.raw<{ rows: Array<{ relname: string }> }>(
    `SELECT i.relname FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
     WHERE x.indrelid = quote_ident(?)::regclass
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         WHERE c.conindid = x.indexrelid AND c.conrelid = x.indrelid AND c.contype IN ('p', 'u', 'x')
       )`,
    [to]
  );
  for (const { relname } of indexes) {
    const next = followName(relname, from, to, GENERATED_INDEX);
    // eslint-disable-next-line no-await-in-loop
    if (next) await tx.raw("ALTER INDEX ?? RENAME TO ??", [relname, next]);
  }
  const { rows: sequences } = await tx.raw<{ rows: Array<{ relname: string }> }>(
    `SELECT s.relname FROM pg_class s JOIN pg_depend d ON d.objid = s.oid
     WHERE s.relkind = 'S' AND d.refobjid = quote_ident(?)::regclass AND d.deptype IN ('a', 'i')`,
    [to]
  );
  for (const { relname } of sequences) {
    const next = followName(relname, from, to, GENERATED_SEQUENCE);
    // eslint-disable-next-line no-await-in-loop
    if (next) await tx.raw("ALTER SEQUENCE ?? RENAME TO ??", [relname, next]);
  }
  // Triggers cloned onto partitions take their name from the parent's.
  const { rows: triggers } = await tx.raw<{ rows: Array<{ tgname: string }> }>(
    "SELECT tgname FROM pg_trigger WHERE tgrelid = quote_ident(?)::regclass AND NOT tgisinternal AND tgparentid = 0 AND tgname LIKE '%\\_updatedAt'",
    [to]
  );
  for (const { tgname } of triggers) {
    const prefix = tgname.slice(0, -"_updatedAt".length);
    const next = prefix === from ? to : currentByLegacy.get(prefix);
    // eslint-disable-next-line no-await-in-loop
    if (next) await tx.raw("ALTER TRIGGER ?? ON ?? RENAME TO ??", [tgname, to, `${next}_updatedAt`]);
  }
};

const moveTables = async (db: Knex, pairs: ReadonlyArray<TPair>, logger?: TRenameLogger) => {
  // One catalog lookup decides whether there is anything to do; most calls find nothing.
  const { rows: pending } = await db.raw<{ rows: unknown[] }>(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = current_schema()
     WHERE c.relkind IN ('r', 'p') AND c.relname = ANY(?) LIMIT 1`,
    [pairs.map(([from]) => from)]
  );
  if (!pending.length) return { renamed: 0, functions: 0 };

  return db.transaction(async (tx) => {
    const { rows } = await tx.raw<{ rows: TRelation[] }>(`
      SELECT c.relname, p.relname AS parent
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = current_schema()
      LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
      LEFT JOIN pg_class p ON p.oid = i.inhparent
      WHERE c.relkind IN ('r', 'p')
    `);
    const existing = new Set(rows.map((row) => row.relname));
    const renamed: TPair[] = [];

    for (const [from, to] of pairs) {
      if (existing.has(from)) {
        if (existing.has(to)) throw new Error(`Both ${from} and ${to} exist. Resolve the duplicate before upgrading.`);
        // eslint-disable-next-line no-await-in-loop
        await tx.raw("ALTER TABLE ?? RENAME TO ??", [from, to]);
        renamed.push([from, to]);
        // eslint-disable-next-line no-await-in-loop
        await followGeneratedNames(tx, from, to);
        // Partitions follow their parent so partition maintenance finds them by name.
        for (const child of rows.filter((row) => row.parent === from && row.relname.startsWith(`${from}_`))) {
          const next = `${to}${child.relname.slice(from.length)}`;
          if (next.length > MAX_IDENTIFIER)
            throw new Error(`Partition name ${next} exceeds ${MAX_IDENTIFIER} characters`);
          // eslint-disable-next-line no-await-in-loop
          await tx.raw("ALTER TABLE ?? RENAME TO ??", [child.relname, next]);
          // eslint-disable-next-line no-await-in-loop
          await followGeneratedNames(tx, child.relname, next);
        }
      }
    }
    if (!renamed.length) return { renamed: 0, functions: 0 };

    // Functions whose bodies name a renamed table are recreated with the new name.
    const { rows: functions } = await tx.raw<{ rows: Array<{ definition: string }> }>(`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = current_schema()
      WHERE p.prokind = 'f'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
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
};

/**
 * Moves an inherited store onto its vx_ table names (docs/0119). Tables already on their vx_ name,
 * or absent, are left alone, so it is safe to run before every migration. Rows, columns, indexes,
 * constraints and triggers move with each table; PostgreSQL-generated names, partitions and
 * functions that name a renamed table follow it.
 *
 * Before a migration body, only TableName ("enum") tables move, because every migration names
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
