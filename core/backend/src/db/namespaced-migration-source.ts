import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Knex } from "knex";

import { useInheritedIndexNames } from "./table-namespace-index-names";
import { renameLegacyTables } from "./table-namespace-rename";

type TMigrationModule = {
  up: (knex: Knex) => Promise<unknown>;
  down?: (knex: Knex) => Promise<unknown>;
  config?: Knex.MigratorConfig;
};

// ts-node (the knex command line in development) registers a CommonJS hook for .ts files, and a
// TypeScript file cannot be imported by URL there. Built .mjs files and vitest import.
const loadMigration = async (file: string): Promise<TMigrationModule> => {
  const tsNode = typeof require === "function" && Boolean(require.extensions?.[".ts"]);
  // eslint-disable-next-line global-require, import/no-dynamic-require, @typescript-eslint/no-var-requires
  if (tsNode && file.endsWith(".ts")) return require(file) as TMigrationModule;
  return (await import(pathToFileURL(file).href)) as TMigrationModule;
};

/**
 * The migration directory, as knex lists it (same file names, same order), with two steps in
 * front of every migration (docs/0119): automatic index names follow inherited table names, and
 * an inherited store moves its TableName tables to vx_ names before any migration body runs.
 * Both steps are idempotent and cost one catalog lookup when there is nothing to do. Startup,
 * both knexfiles (which `vaultix server upgrade` uses) and the e2e environment share this source,
 * so a store behind by several migrations upgrades the same way on every path.
 */
export class NamespacedMigrationSource implements Knex.MigrationSource<string> {
  constructor(
    private readonly directory: string,
    private readonly extensions: string[] = [".mjs", ".ts"]
  ) {}

  async getMigrations() {
    const files = await readdir(this.directory);
    return files.filter((file) => this.extensions.includes(path.extname(file))).sort();
  }

  // Part of knex's MigrationSource contract; the stored name is the file name, as knex records it.
  // eslint-disable-next-line class-methods-use-this
  getMigrationName(file: string) {
    return file;
  }

  async getMigration(file: string): Promise<Knex.Migration> {
    const migration = await loadMigration(path.join(this.directory, file));
    const { up, down } = migration;
    return {
      ...migration,
      up: async (knex: Knex) => {
        useInheritedIndexNames(knex);
        await renameLegacyTables(knex);
        return up(knex);
      },
      down: down
        ? async (knex: Knex) => {
            useInheritedIndexNames(knex);
            return down(knex);
          }
        : undefined
    };
  }
}
