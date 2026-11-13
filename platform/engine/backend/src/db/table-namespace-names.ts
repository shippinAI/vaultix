import { LEGACY_TABLE_RENAMES } from "./table-namespaces";

// One lookup between inherited table names and their vx_ names (docs/0119).
const legacyByCurrent = new Map(LEGACY_TABLE_RENAMES.map(([legacy, current]) => [current, legacy]));

// The inherited name of a vx_ table, or the name itself for tables created after the rename.
export const inheritedTableName = (table: string) => legacyByCurrent.get(table) ?? table;

export const MAX_IDENTIFIER = 63;

/**
 * PostgreSQL's makeObjectName: name1_name2_label, shortening the longer of name1 and name2 one
 * character at a time until it fits in 63 bytes. Constraint, index, trigger and sequence names
 * PostgreSQL generates follow it, so a renamed table's generated names can be made identical to
 * the ones a fresh store gets.
 */
export const makeObjectName = (name1: string, name2: string | undefined, label: string) => {
  let name1Chars = name1.length;
  let name2Chars = name2 ? name2.length : 0;
  const overhead = label.length + 1 + (name2 ? 1 : 0);
  const available = MAX_IDENTIFIER - overhead;
  while (name1Chars + name2Chars > available) {
    if (name1Chars > name2Chars) name1Chars -= 1;
    else name2Chars -= 1;
  }
  return `${name1.slice(0, name1Chars)}${name2 ? `_${name2.slice(0, name2Chars)}` : ""}_${label}`;
};
