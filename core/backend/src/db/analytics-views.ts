/** Vaultix's explicit analytics projection. No expressions, wildcards or raw SQL inputs. */
export type AnalyticsView = { name: string; source: string; columns: string[] };
export type AnalyticsViewConfig = { tables: AnalyticsView[] };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_$-]*$/.test(value) || Buffer.byteLength(value) > 63) {
    throw new Error("Invalid analytics identifier. Use a PostgreSQL name of at most 63 bytes.");
  }
  return value;
};

const quote = (value: string): string => `"${identifier(value)}"`;

export const readAnalyticsViewConfig = (input: unknown): AnalyticsViewConfig => {
  if (!object(input) || Object.keys(input).some((key) => key !== "tables")) {
    throw new Error("Analytics configuration must contain only a tables list.");
  }
  if (!Array.isArray(input.tables) || input.tables.length === 0 || input.tables.length > 2048) {
    throw new Error("Analytics configuration requires between 1 and 2048 views.");
  }
  const names = new Set<string>();
  const tables = input.tables.map((raw): AnalyticsView => {
    if (!object(raw) || Object.keys(raw).some((key) => !["name", "source", "columns"].includes(key))) {
      throw new Error("An analytics view accepts only name, source and columns.");
    }
    const name = identifier(raw.name);
    if (names.has(name)) throw new Error("Analytics view names must be unique.");
    names.add(name);
    if (typeof raw.source !== "string") throw new Error("Analytics views require a source table.");
    const source = raw.source.split(".");
    if (source.length !== 2) throw new Error("Analytics source tables must include an explicit schema.");
    source.forEach(identifier);
    if (!Array.isArray(raw.columns) || raw.columns.length === 0 || raw.columns.length > 1600) {
      throw new Error("Analytics views require an explicit nonempty column list.");
    }
    const columns = raw.columns.map(identifier);
    if (new Set(columns).size !== columns.length) throw new Error("Analytics columns must be unique within a view.");
    return { name, source: source.join("."), columns };
  });
  return { tables };
};

export const buildAnalyticsViewStatements = (input: unknown, schema: string): string[] => {
  const target = quote(schema);
  const { tables } = readAnalyticsViewConfig(input);
  return [
    `CREATE SCHEMA IF NOT EXISTS ${target};`,
    ...tables.map(
      (view) =>
        `CREATE VIEW ${target}.${quote(view.name)} AS SELECT ${view.columns.map(quote).join(", ")} FROM ${view.source
          .split(".")
          .map(quote)
          .join(".")};`
    )
  ];
};

export const buildAnalyticsGrantStatements = (schema: string, role: string): string[] => {
  // Roles previously allowed a leading digit. Quoting preserves that compatibility.
  if (!/^[A-Za-z0-9_-]+$/.test(role) || Buffer.byteLength(role) > 63) {
    throw new Error("Invalid analytics role. Use letters, digits, underscores or hyphens, at most 63 bytes.");
  }
  const target = quote(schema);
  return [
    `GRANT USAGE ON SCHEMA ${target} TO "${role}";`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${target} TO "${role}";`
  ];
};
