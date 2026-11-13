import {
  CreateMySqlCredentialsRotationSchema,
  MySqlCredentialsRotationSchema,
  UpdateMySqlCredentialsRotationSchema
} from "@app/shippin/services/secret-rotation-v2/mysql-credentials";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";
import { SqlCredentialsRotationGeneratedCredentialsSchema } from "@app/shippin/services/secret-rotation-v2/shared/sql-credentials";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerMySqlCredentialsRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.MySqlCredentials,
    server,
    responseSchema: MySqlCredentialsRotationSchema,
    createSchema: CreateMySqlCredentialsRotationSchema,
    updateSchema: UpdateMySqlCredentialsRotationSchema,
    generatedCredentialsSchema: SqlCredentialsRotationGeneratedCredentialsSchema
  });
