import { Knex } from "knex";

import { renameLegacyTables, restoreLegacyTables } from "../table-namespace-rename";

// docs/0119: every inherited table name becomes vx_<group>_<entity>. Startup already moves an
// inherited store before pending migrations run; this migration records the change in the
// migration set (so `vaultix server upgrade` rehearses it) and covers direct knex runs.
export async function up(knex: Knex): Promise<void> {
  await renameLegacyTables(knex, undefined, "all");
}

export async function down(knex: Knex): Promise<void> {
  await restoreLegacyTables(knex);
}
