import {
  CreatePostgresCredentialsRotationSchema,
  PostgresCredentialsRotationSchema,
  UpdatePostgresCredentialsRotationSchema
} from "@app/services/secret-rotation-v2/postgres-credentials";
import { SecretRotation } from "@app/services/secret-rotation-v2/secret-rotation-v2-enums";
import { SqlCredentialsRotationGeneratedCredentialsSchema } from "@app/services/secret-rotation-v2/shared/sql-credentials";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerPostgresCredentialsRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.PostgresCredentials,
    server,
    responseSchema: PostgresCredentialsRotationSchema,
    createSchema: CreatePostgresCredentialsRotationSchema,
    updateSchema: UpdatePostgresCredentialsRotationSchema,
    generatedCredentialsSchema: SqlCredentialsRotationGeneratedCredentialsSchema
  });
