import { Knex } from "knex";

import { renameLegacyTables } from "../table-namespace-rename";

// docs/0119: every inherited table name becomes vx_<group>_<entity>. The migration source already
// moves TableName tables before each migration; this migration moves the tables raw-SQL migrations
// created under inherited names, and records the change so `vaultix server upgrade` rehearses it.
export async function up(knex: Knex): Promise<void> {
  await renameLegacyTables(knex, undefined, "all");
}

// Every earlier migration now names its tables with vx_ names, so restoring inherited names here
// would leave their down steps pointing at tables that no longer exist. Going back across this
// change means restoring the pre-upgrade checkpoint with `vaultix server rollback`.
export async function down(): Promise<void> {
  throw new Error(
    "The vx_ table namespace migration is not reversible with knex. Restore the pre-upgrade checkpoint with `vaultix server rollback` (docs/0119)."
  );
}
