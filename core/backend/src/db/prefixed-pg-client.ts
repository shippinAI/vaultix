import PgClient from "knex/lib/dialects/postgres";

import { createSqlPrefixer, normalizeTablePrefix } from "@app/db/table-prefix";

/**
 * Knex client that rewrites table, index, constraint, trigger, sequence, and
 * routine names for one DB_TABLE_PREFIX. Customer connections (dynamic secrets,
 * external SQL) must keep using the stock `pg` client.
 */
export const createPrefixedPgClient = (rawPrefix?: string | null) => {
  const prefixer = createSqlPrefixer(normalizeTablePrefix(rawPrefix));

  class PrefixedPgClient extends PgClient {
    // Knex calls this with the compiled statement before Postgres sees it.
    // The base client is untyped JavaScript.
    override query(connection: unknown, queryParam: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return super.query(connection, prefixer.rewriteQuery(queryParam));
    }
  }

  return PrefixedPgClient;
};
