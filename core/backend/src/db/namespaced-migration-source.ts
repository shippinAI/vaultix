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

/**
 * The migration directory, as knex lists it (same file names, same order), with two steps in
 * front of every migration (docs/0119): automatic index names follow inherited table names, and
 * an inherited store moves its TableName tables to vx_ names before any migration body runs.
 * Both steps are idempotent. Startup and the knex command line (which `vaultix server upgrade`
 * uses) share this source, so a store behind by several migrations upgrades the same way on
 * either path.
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
    const migration = (await import(pathToFileURL(path.join(this.directory, file)).href)) as TMigrationModule;
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
