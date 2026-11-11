// eslint-disable-next-line
import "ts-node/register";

import dotenv from "dotenv";
import type { Knex } from "knex";
import path from "path";
import { initLogger } from "@app/lib/logger";

import { DbApplicationName } from "./instance";
import { NamespacedMigrationSource } from "./namespaced-migration-source";

// Update with your config settings. .
dotenv.config({
  path: path.join(__dirname, "../../../.env.migration")
});
dotenv.config({
  path: path.join(__dirname, "../../../.env")
});

initLogger();

// The knex command line (which `vaultix server upgrade` runs) uses the same migration source as
// startup: knex's file order, with the vx_ table steps in front (docs/0119). knex ignores a
// migrationSource next to directory or loadExtensions, so neither is set here.
const migrations: Knex.MigratorConfig = {
  tableName: "vaultix_migrations",
  migrationSource: new NamespacedMigrationSource(path.join(__dirname, "migrations"))
};

export default {
  development: {
    client: "postgres",
    connection: {
      connectionString: process.env.DB_CONNECTION_URI,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_ROOT_CERT
        ? {
            rejectUnauthorized: true,
            ca: Buffer.from(process.env.DB_ROOT_CERT, "base64").toString("ascii")
          }
        : false,
      application_name: DbApplicationName.Migrator
    },
    pool: {
      min: 2,
      max: 10
    },
    seeds: {
      directory: "./seeds"
    },
    migrations
  },
  production: {
    client: "postgres",
    connection: {
      connectionString: process.env.DB_CONNECTION_URI,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_ROOT_CERT
        ? {
            rejectUnauthorized: true,
            ca: Buffer.from(process.env.DB_ROOT_CERT, "base64").toString("ascii")
          }
        : false,
      application_name: DbApplicationName.Migrator
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations
  }
} as Knex.Config;
