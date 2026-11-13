import { z } from "zod";

import { TMsSqlCredentialsRotationWithConnection } from "@app/shippin/services/secret-rotation-v2/mssql-credentials";
import { TMySqlCredentialsRotationWithConnection } from "@app/shippin/services/secret-rotation-v2/mysql-credentials";
import { TOracleDBCredentialsRotationWithConnection } from "@app/shippin/services/secret-rotation-v2/oracledb-credentials";
import { TPostgresCredentialsRotationWithConnection } from "@app/shippin/services/secret-rotation-v2/postgres-credentials";
import { SqlCredentialsRotationGeneratedCredentialsSchema } from "@app/shippin/services/secret-rotation-v2/shared/sql-credentials/sql-credentials-rotation-schemas";

export type TSqlCredentialsRotationWithConnection =
  | TPostgresCredentialsRotationWithConnection
  | TMsSqlCredentialsRotationWithConnection
  | TMySqlCredentialsRotationWithConnection
  | TOracleDBCredentialsRotationWithConnection;

export type TSqlCredentialsRotationGeneratedCredentials = z.infer<
  typeof SqlCredentialsRotationGeneratedCredentialsSchema
>;
