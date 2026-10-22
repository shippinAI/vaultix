// eslint-disable-next-line
import "ts-node/register";

import dotenv from "dotenv";
import type { Knex } from "knex";
import path from "path";
import { initLogger } from "@app/lib/logger";

import { DbApplicationName } from "./instance";
import { createPrefixedPgClient } from "./prefixed-pg-client";

// Update with your config settings. .
dotenv.config({
  path: path.join(__dirname, "../../../.env.migration")
});
dotenv.config({
  path: path.join(__dirname, "../../../.env")
});

initLogger();

const client = createPrefixedPgClient(process.env.DB_TABLE_PREFIX);

export default {
  development: {
    client,
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
    migrations: {
      tableName: "vaultix_migrations",
      loadExtensions: [".mjs", ".ts"]
    }
  },
  production: {
    client,
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
    migrations: {
      tableName: "vaultix_migrations",
      loadExtensions: [".mjs", ".ts"]
    }
  }
} as Knex.Config;
