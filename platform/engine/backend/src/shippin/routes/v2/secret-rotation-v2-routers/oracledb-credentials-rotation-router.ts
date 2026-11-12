import {
  CreateOracleDBCredentialsRotationSchema,
  OracleDBCredentialsRotationSchema,
  UpdateOracleDBCredentialsRotationSchema
} from "@app/shippin/services/secret-rotation-v2/oracledb-credentials";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";
import { SqlCredentialsRotationGeneratedCredentialsSchema } from "@app/shippin/services/secret-rotation-v2/shared/sql-credentials";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerOracleDBCredentialsRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.OracleDBCredentials,
    server,
    responseSchema: OracleDBCredentialsRotationSchema,
    createSchema: CreateOracleDBCredentialsRotationSchema,
    updateSchema: UpdateOracleDBCredentialsRotationSchema,
    generatedCredentialsSchema: SqlCredentialsRotationGeneratedCredentialsSchema
  });
