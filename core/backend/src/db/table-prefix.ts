import { createHash } from "node:crypto";

import { TableName } from "@app/db/schemas/models";

// Single-pass scanner. Helpers sit below the rewriter that calls them.
/* eslint-disable no-continue, @typescript-eslint/no-use-before-define */

/**
 * Physical names that are not the current TableName enum but still appear in
 * migrations (renames, backups, and the knex migrations table).
 */
export const AUXILIARY_TABLES = [
  "gateway_enrollment_tokens",
  "intermediate_audit_logs",
  "intermediate_certificate_requests",
  "pam_revamp_backup",
  "vaultix_migrations",
  "infisical_migrations"
] as const;

export const ROUTINES = ["on_update_timestamp"] as const;

const PG_IDENT_MAX = 63;

const SKIP_KEYWORDS = new Set(["if", "not", "exists", "concurrently", "unique", "or", "replace", "local"]);

/**
 * Words that are SQL syntax rather than physical names. While a DDL clause is
 * waiting for an object name (`CREATE INDEX [CONCURRENTLY] [IF NOT EXISTS]`),
 * these must not be consumed as that name. Table names in this codebase are
 * not SQL keywords.
 */
const SQL_KEYWORDS = new Set([
  "access",
  "action",
  "add",
  "after",
  "all",
  "alter",
  "analyze",
  "and",
  "as",
  "asc",
  "before",
  "begin",
  "by",
  "cascade",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "comment",
  "concurrently",
  "conflict",
  "constraint",
  "create",
  "cross",
  "default",
  "deferrable",
  "deferred",
  "delete",
  "desc",
  "distinct",
  "do",
  "drop",
  "each",
  "else",
  "end",
  "excluded",
  "exclusive",
  "execute",
  "exists",
  "false",
  "filter",
  "first",
  "for",
  "foreign",
  "from",
  "full",
  "function",
  "grant",
  "group",
  "having",
  "if",
  "immediate",
  "in",
  "index",
  "initially",
  "inner",
  "insert",
  "instead",
  "into",
  "is",
  "join",
  "key",
  "language",
  "last",
  "lateral",
  "left",
  "limit",
  "local",
  "locked",
  "match",
  "materialized",
  "mode",
  "natural",
  "not",
  "nothing",
  "nowait",
  "null",
  "nulls",
  "of",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "over",
  "owner",
  "partial",
  "partition",
  "primary",
  "procedure",
  "recursive",
  "references",
  "rename",
  "replace",
  "reset",
  "restrict",
  "returning",
  "returns",
  "right",
  "row",
  "schema",
  "select",
  "sequence",
  "session",
  "set",
  "share",
  "show",
  "simple",
  "skip",
  "table",
  "temp",
  "temporary",
  "then",
  "to",
  "trigger",
  "true",
  "type",
  "union",
  "unique",
  "unlogged",
  "update",
  "using",
  "values",
  "verbose",
  "view",
  "when",
  "where",
  "with"
]);

const SCHEMA_QUALIFIERS = new Set(["public", "information_schema", "pg_catalog"]);

const CATALOG_RE =
  /\b(pg_trigger|pg_indexes|pg_class|pg_constraint|pg_tables|pg_namespace|pg_index|information_schema)\b/i;

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const knownPhysicalTables = (): string[] => {
  const names = new Set<string>();
  for (const name of Object.values(TableName)) names.add(name);
  for (const name of AUXILIARY_TABLES) names.add(name);
  return [...names];
};

/**
 * Empty means current unprefixed names. A trailing underscore is added when
 * missing so `t1` and `t1_` are the same prefix and cannot glue onto `users`.
 */
export const normalizeTablePrefix = (raw: string | undefined | null): string => {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const stem = value.endsWith("_") ? value.slice(0, -1) : value;
  if (!/^[a-z][a-z0-9_]{0,10}$/.test(stem)) {
    throw new Error(
      "DB_TABLE_PREFIX must be empty or start with a lowercase letter and contain only lowercase letters, digits, and underscores (at most 11 characters). Example: acme"
    );
  }
  return `${stem}_`;
};

export const fitIdent = (prefix: string, name: string): string => {
  const full = `${prefix}${name}`;
  if (Buffer.byteLength(full) <= PG_IDENT_MAX) return full;
  const hash = createHash("sha256").update(full).digest("hex").slice(0, 8);
  const budget = PG_IDENT_MAX - Buffer.byteLength(prefix) - 1 - hash.length;
  let sliced = "";
  let bytes = 0;
  for (const ch of name) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > budget) break;
    sliced += ch;
    bytes += size;
  }
  return `${prefix}${sliced}_${hash}`;
};

export const applyPrefix = (prefix: string, name: string): string => {
  if (!prefix) return name;
  if (name.toLowerCase().startsWith(prefix)) return name;
  return fitIdent(prefix, name);
};

type ObjectMode = "index" | "constraint" | "trigger" | "sequence" | null;
type BindingKind = "table" | "object" | null;

export type SqlPrefixer = {
  readonly prefix: string;
  prefixSql: (sql: string) => string;
  prefixBindings: (sql: string, bindings: unknown) => unknown;
  rewriteQuery: (queryParam: unknown) => unknown;
};

export const createSqlPrefixer = (prefix: string): SqlPrefixer => {
  if (!prefix) {
    return {
      prefix: "",
      prefixSql: (sql) => sql,
      prefixBindings: (_sql, bindings) => bindings,
      rewriteQuery: (queryParam) => queryParam
    };
  }

  const tables = new Set<string>();
  for (const name of knownPhysicalTables()) tables.add(name.toLowerCase());
  const tablesByLength = [...tables].sort((a, b) => b.length - a.length);
  const routines = new Set(ROUTINES.map((name) => name.toLowerCase()));

  const classify = (original: string): string | null => {
    const lower = original.toLowerCase();
    if (lower.startsWith(prefix)) return null;
    if (routines.has(lower)) return fitIdent(prefix, original);
    if (tables.has(lower)) return fitIdent(prefix, lower);
    for (const table of tablesByLength) {
      if (lower.startsWith(`${table}_`)) {
        return fitIdent(prefix, table + original.slice(table.length));
      }
    }
    return null;
  };

  const forceObjectName = (original: string): string => {
    const lower = original.toLowerCase();
    if (lower.startsWith(prefix) || SCHEMA_QUALIFIERS.has(lower)) return original;
    return classify(original) ?? fitIdent(prefix, original);
  };

  const prefixStringLiteral = (content: string): string => {
    const { body, stripped } = splitPublicQualifier(content);
    const lower = body.toLowerCase();
    if (lower.startsWith(prefix)) return stripped ? body : content;
    for (const table of tablesByLength) {
      if (!lower.startsWith(table)) continue;
      const next = lower.charAt(table.length);
      if (next === "" || next === "_" || next === "%") {
        return fitIdent(prefix, table) + body.slice(table.length);
      }
    }
    return classify(body) ?? content;
  };

  const rewriteCatalogString = (content: string, codeTail: string): string => {
    const { body } = splitPublicQualifier(content);
    const tail = codeTail.replace(/"/g, "");
    if (/(?:indexname|conname|tgname|relname)\s*=\s*$/i.test(tail) && IDENT_RE.test(body)) {
      if (body.toLowerCase().startsWith(prefix)) return body;
      return classify(body) ?? fitIdent(prefix, body);
    }
    return prefixStringLiteral(content);
  };

  const prefixSql = (sql: string): string => rewriteSql(sql, true);

  const prefixBindings = (sql: string, bindings: unknown): unknown => {
    if (!Array.isArray(bindings) || bindings.length === 0) return bindings;
    const kinds = bindingKinds(sql, bindings.length);
    if (kinds.every((kind) => kind === null)) return bindings;
    return bindings.map((value, index) => prefixBound(kinds[index], value));
  };

  const prefixBound = (kind: BindingKind, value: unknown): unknown => {
    if (kind === null || typeof value !== "string") return value;
    const { body } = splitPublicQualifier(value);
    if (!IDENT_RE.test(body)) return value;
    if (body.toLowerCase().startsWith(prefix)) return body;
    const classified = classify(body);
    if (classified) return classified;
    if (kind === "object") return fitIdent(prefix, body);
    return value;
  };

  const rewriteQuery = (queryParam: unknown): unknown => {
    if (typeof queryParam === "string") return prefixSql(queryParam);
    if (!queryParam || typeof queryParam !== "object" || !("sql" in queryParam)) return queryParam;
    const query = queryParam as { sql?: unknown; bindings?: unknown };
    if (typeof query.sql !== "string") return queryParam;
    return {
      ...query,
      bindings: prefixBindings(query.sql, query.bindings),
      sql: prefixSql(query.sql)
    };
  };

  function rewriteSql(sql: string, rewriteStrings: boolean): string {
    const strings = rewriteStrings && statementRewritesStrings(sql);
    let out = "";
    let i = 0;
    let nameList: ObjectMode = null;
    let expectName = false;
    let prevKeyword = "";
    let codeTail = "";

    const note = (text: string) => {
      codeTail = (codeTail + text).slice(-160);
    };

    const clearNames = () => {
      nameList = null;
      expectName = false;
    };

    const onKeyword = (word: string) => {
      const w = word.toLowerCase();
      if (SKIP_KEYWORDS.has(w)) {
        // `CREATE UNIQUE INDEX` must still see prev=create. `UNIQUE` after a
        // constraint name ends the name and must not swallow the column list.
        if (w === "unique" && nameList === "constraint") clearNames();
        return;
      }
      if (w === "index" && (prevKeyword === "create" || prevKeyword === "drop" || prevKeyword === "alter")) {
        nameList = "index";
        expectName = true;
      } else if (w === "constraint") {
        nameList = "constraint";
        expectName = true;
      } else if (w === "trigger" && (prevKeyword === "create" || prevKeyword === "drop")) {
        nameList = "trigger";
        expectName = true;
      } else if (w === "sequence" && (prevKeyword === "create" || prevKeyword === "drop")) {
        nameList = "sequence";
        expectName = true;
      } else if (
        w === "on" ||
        w === "where" ||
        w === "using" ||
        w === "set" ||
        w === "foreign" ||
        w === "primary" ||
        w === "check" ||
        w === "references"
      ) {
        clearNames();
      }
      prevKeyword = w;
    };

    const emitIdent = (original: string, quoted: boolean) => {
      let next = original;
      const lower = original.toLowerCase();
      if (expectName && SCHEMA_QUALIFIERS.has(lower)) {
        next = original;
      } else if (expectName) {
        next = forceObjectName(original);
        expectName = false;
      } else {
        const classified = classify(original);
        if (classified) next = classified;
      }
      const rendered = quoted ? `"${next.replace(/"/g, '""')}"` : next;
      out += rendered;
      note(rendered);
    };

    const shouldDropPublic = (name: string) => {
      const lower = name.toLowerCase();
      if (SCHEMA_QUALIFIERS.has(lower)) return false;
      if (lower.startsWith(prefix)) return true;
      if (classify(name)) return true;
      return expectName;
    };

    /** `public.users` becomes the prefixed unqualified name so search_path picks the schema. */
    const consumePublicQualifier = (afterSchema: number) => {
      const peeked = peekDotIdent(sql, afterSchema);
      if (!peeked || !shouldDropPublic(peeked.content)) return false;
      emitIdent(peeked.content, peeked.quoted);
      i = peeked.end;
      return true;
    };

    while (i < sql.length) {
      const ch = sql[i];

      if (ch === "-" && sql[i + 1] === "-") {
        const end = sql.indexOf("\n", i);
        const stop = end === -1 ? sql.length : end;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
      if (ch === "/" && sql[i + 1] === "*") {
        const end = sql.indexOf("*/", i + 2);
        const stop = end === -1 ? sql.length : end + 2;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
      if (ch === "$") {
        const tag = readDollarTag(sql, i);
        if (tag) {
          const close = sql.indexOf(tag, i + tag.length);
          const stop = close === -1 ? sql.length : close + tag.length;
          out += sql.slice(i, stop);
          i = stop;
          continue;
        }
      }
      if (ch === "'") {
        const { content, end } = readSingleQuoted(sql, i);
        const next = strings || isRegclassCast(sql, end) ? rewriteCatalogString(content, codeTail) : content;
        out += `'${next.replace(/'/g, "''")}'`;
        note("''");
        i = end;
        continue;
      }
      if (ch === '"') {
        const { content, end } = readDoubleQuoted(sql, i);
        if (content.toLowerCase() === "public" && consumePublicQualifier(end)) continue;
        emitIdent(content, true);
        i = end;
        continue;
      }
      if (ch === ";") {
        clearNames();
        prevKeyword = "";
        out += ch;
        note(ch);
        i += 1;
        continue;
      }
      if (ch === ",") {
        if (nameList === "index" || nameList === "sequence") expectName = true;
        out += ch;
        note(ch);
        i += 1;
        continue;
      }
      if (isIdentStart(ch)) {
        let j = i + 1;
        while (j < sql.length && isIdentPart(sql[j])) j += 1;
        const word = sql.slice(i, j);
        const lower = word.toLowerCase();
        if (lower === "public" && consumePublicQualifier(j)) continue;
        // Routine names stay prefixed even when the next token is `(`.
        // Other call targets (count, gen_random_uuid, pg_advisory_xact_lock) do not.
        if (routines.has(lower)) {
          const next = classify(word) ?? word;
          out += next;
          note(next);
        } else if (SQL_KEYWORDS.has(lower) || (isKeywordContext(sql, j) && !tables.has(lower))) {
          // A table followed by `(` is an index or column list (`ON users ("id")`),
          // not a function call. Only unknown names in call position stay as-is.
          onKeyword(word);
          out += word;
          note(word);
        } else {
          emitIdent(word, false);
        }
        i = j;
        continue;
      }

      out += ch;
      note(ch);
      i += 1;
    }

    return out;
  }

  return { prefix, prefixSql, prefixBindings, rewriteQuery };
};

const isIdentStart = (ch: string) => /[A-Za-z_]/.test(ch);
const isIdentPart = (ch: string) => /[A-Za-z0-9_]/.test(ch);

/** `'public.users'` → body `users`. Other schemas stay qualified. */
const splitPublicQualifier = (content: string): { body: string; stripped: boolean } => {
  if (content.length >= 7 && content.slice(0, 7).toLowerCase() === "public.") {
    const rest = content.slice(7);
    if (/^[A-Za-z_]/.test(rest)) return { body: rest, stripped: true };
  }
  return { body: content, stripped: false };
};

const isRegclassCast = (sql: string, pos: number) => {
  let k = pos;
  while (k < sql.length && (sql[k] === " " || sql[k] === "\n" || sql[k] === "\t" || sql[k] === "\r")) k += 1;
  return sql.slice(k, k + 10).toLowerCase() === "::regclass";
};

type PeekedIdent = { content: string; quoted: boolean; end: number };

const peekDotIdent = (sql: string, pos: number): PeekedIdent | null => {
  let k = pos;
  while (k < sql.length && (sql[k] === " " || sql[k] === "\n" || sql[k] === "\t" || sql[k] === "\r")) k += 1;
  if (sql[k] !== ".") return null;
  k += 1;
  while (k < sql.length && (sql[k] === " " || sql[k] === "\n" || sql[k] === "\t" || sql[k] === "\r")) k += 1;
  if (sql[k] === '"') {
    const read = readDoubleQuoted(sql, k);
    return { content: read.content, quoted: true, end: read.end };
  }
  if (!isIdentStart(sql[k] ?? "")) return null;
  let j = k + 1;
  while (j < sql.length && isIdentPart(sql[j])) j += 1;
  return { content: sql.slice(k, j), quoted: false, end: j };
};

/** An identifier followed by `(` is a function or keyword call, not a table. */
const isKeywordContext = (sql: string, end: number) => {
  let k = end;
  while (k < sql.length && (sql[k] === " " || sql[k] === "\n" || sql[k] === "\t" || sql[k] === "\r")) k += 1;
  return sql[k] === "(";
};

const readDollarTag = (sql: string, start: number): string | null => {
  if (sql[start] !== "$") return null;
  let j = start + 1;
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
  if (sql[j] !== "$") return null;
  return sql.slice(start, j + 1);
};

const readSingleQuoted = (sql: string, start: number) => {
  let content = "";
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'" && sql[i + 1] === "'") {
      content += "'";
      i += 2;
      continue;
    }
    if (sql[i] === "'") return { content, end: i + 1 };
    content += sql[i];
    i += 1;
  }
  return { content, end: sql.length };
};

const readDoubleQuoted = (sql: string, start: number) => {
  let content = "";
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === '"' && sql[i + 1] === '"') {
      content += '"';
      i += 2;
      continue;
    }
    if (sql[i] === '"') return { content, end: i + 1 };
    content += sql[i];
    i += 1;
  }
  return { content, end: sql.length };
};

const statementRewritesStrings = (sql: string): boolean => {
  let i = 0;
  let visible = "";
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === "'") {
      i = readSingleQuoted(sql, i).end;
      visible += "''";
      continue;
    }
    if (ch === '"') {
      const ident = readDoubleQuoted(sql, i);
      visible += ident.content;
      i = ident.end;
      continue;
    }
    if (ch === "$") {
      const tag = readDollarTag(sql, i);
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? sql.length : close + tag.length;
        continue;
      }
    }
    visible += ch;
    i += 1;
  }
  return CATALOG_RE.test(visible);
};

const bindingKinds = (sql: string, count: number): BindingKind[] => {
  const kinds: BindingKind[] = [];
  let i = 0;
  let visible = "";
  while (i < sql.length && kinds.length < count) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === "'") {
      i = readSingleQuoted(sql, i).end;
      visible += "''";
      continue;
    }
    if (ch === '"') {
      const ident = readDoubleQuoted(sql, i);
      visible += ident.content;
      i = ident.end;
      continue;
    }
    if (ch === "$") {
      const tag = readDollarTag(sql, i);
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? sql.length : close + tag.length;
        continue;
      }
    }
    if (ch === "?" && sql[i - 1] !== "\\") {
      let kind = kindBeforePlaceholder(visible);
      if (kind === null && isRegclassCast(sql, i + 1)) kind = "table";
      kinds.push(kind);
      visible += "?";
      i += 1;
      continue;
    }
    visible += ch;
    i += 1;
  }
  while (kinds.length < count) kinds.push(null);
  return kinds;
};

const kindBeforePlaceholder = (visible: string): BindingKind => {
  const tail = visible.slice(-80).replace(/"/g, "");
  if (/(?:indexname|conname|tgname)\s*(?:=|like|ilike)\s*$/i.test(tail)) return "object";
  if (/(?:table_name|tablename|relname)\s*(?:=|like|ilike)\s*$/i.test(tail)) return "table";
  return null;
};
