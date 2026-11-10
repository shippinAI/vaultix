// Finds and rewrites inherited table names where SQL or a query builder names a relation
// (docs/0119). Used by scripts/check-table-namespaces.mjs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "vendor", "build", ".cache"]);

export const sourceFiles = (root, dirs, extensions = /\.(ts|tsx|go|mjs|js|sql)$/) => {
  const out = [];
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.test(entry)) out.push(path);
    }
  };
  for (const dir of dirs) walk(join(root, dir));
  return out.map(path => ({ path, rel: relative(root, path).replaceAll("\\", "/") }));
};

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = names => [...names].sort((a, b) => b.length - a.length).map(escape).join("|");

// Each rule captures (before)(name)(after); the rewrite keeps before and after.
export const sqlRules = names => {
  const n = alternation(names);
  return [
    // FROM / JOIN / INTO / UPDATE / TABLE / REFERENCES / TRUNCATE / ONLY name, optionally quoted or qualified.
    new RegExp(`(\\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|TRUNCATE|ONLY)\\s+(?:public\\.)?(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?"?)(${n})("?)(?![A-Za-z0-9_])`, "g"),
    // CREATE INDEX … ON name (…) / USING …; CREATE TRIGGER … ON name FOR …
    new RegExp(`(\\bON\\s+(?:public\\.)?"?)(${n})("?)(?=\\s*(?:\\(|USING\\b|FOR\\b|$))`, "gm"),
    // name."column", name.id, name.*, name%ROWTYPE
    new RegExp(`((?<![A-Za-z0-9_.$]))(${n})(%ROWTYPE|\\."[A-Za-z]|\\.(?:id|\\*)\\b)`, "g"),
    // 'public.name'::regclass
    new RegExp(`('(?:public\\.)?"?)(${n})("?'\\s*::\\s*regclass)`, "g"),
    // to_regclass('name'), relname = 'name', table_name = 'name', tablename = 'name'
    new RegExp(`((?:to_regclass\\s*\\(\\s*|\\b(?:relname|table_name|tablename)\\s*=\\s*)'(?:public\\.)?)(${n})(')`, "g")
  ];
};

// A string literal that is exactly a table name, as passed to a query builder.
export const literalPattern = names => new RegExp(`(["'\`])(${alternation(names)})\\1`, "g");

export const rewriteSql = (text, renames) => {
  let count = 0;
  const next = sqlRules(renames.keys()).reduce(
    (current, rule) =>
      current.replace(rule, (match, before, name, after) => {
        count += 1;
        return `${before}${renames.get(name)}${after}`;
      }),
    text
  );
  return { text: next, count };
};

export const findReferences = (text, names) => {
  const hits = [];
  const rules = sqlRules(names);
  const literal = literalPattern(names);
  text.split("\n").forEach((line, index) => {
    for (const rule of rules) for (const match of line.matchAll(rule)) hits.push({ line: index + 1, kind: "sql", name: match[2], text: line.trim() });
    for (const match of line.matchAll(literal)) hits.push({ line: index + 1, kind: "literal", name: match[2], text: line.trim() });
  });
  return hits;
};
