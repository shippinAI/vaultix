import { Knex } from "knex";

import { LEGACY_TABLE_RENAMES } from "./table-namespaces";

// knex names unnamed indexes, unique constraints and foreign keys `<table>_<columns>_<type>`,
// and PostgreSQL cuts identifiers at 63 characters. Renaming a table keeps those names, so an
// upgraded store carries the inherited spelling. Naming them after the inherited table on a
// fresh store too keeps both stores identical, keeps migrations that drop constraints by name
// working on either, and avoids collisions the longer vx_ names would cause after truncation
// (docs/0119). Tables created after the rename have no inherited name and use their own.
const inheritedByCurrent = new Map(LEGACY_TABLE_RENAMES.map(([legacy, current]) => [current, legacy]));

type TIndexCommand = (type: string, tableName: string, columns: string | string[] | undefined) => string;
type TTableCompiler = { _indexCommand: TIndexCommand };
type TNamingClient = {
  tableCompiler: (...args: unknown[]) => TTableCompiler;
  vxInheritedIndexNames?: boolean;
};

export const inheritedIndexTable = (tableName: string) => inheritedByCurrent.get(tableName) ?? tableName;

// knex builds each transaction's client from the dialect's prototype, not from the connection's
// client, so the naming is applied once to the PostgreSQL client prototype reached through a
// real connection. Every connection and transaction then names indexes the same way.
export const useInheritedIndexNames = (db: Knex) => {
  const client = Object.getPrototypeOf(db.client) as TNamingClient;
  if (Object.prototype.hasOwnProperty.call(client, "vxInheritedIndexNames")) return db;
  client.vxInheritedIndexNames = true;
  const create = client.tableCompiler;
  // A plain function keeps `this` as the calling client, including a transaction's client.
  client.tableCompiler = function tableCompiler(this: TNamingClient, ...args: unknown[]) {
    const compiler = create.apply(this, args);
    /* eslint-disable no-underscore-dangle -- knex's own method name */
    const original = compiler._indexCommand.bind(compiler);
    compiler._indexCommand = (type, tableName, columns) => original(type, inheritedIndexTable(tableName), columns);
    /* eslint-enable no-underscore-dangle */
    return compiler;
  };
  return db;
};
