import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";
import {
  CreateSnowflakeUserKeyPairRotationSchema,
  SnowflakeUserKeyPairRotationGeneratedCredentialsSchema,
  SnowflakeUserKeyPairRotationSchema,
  UpdateSnowflakeUserKeyPairRotationSchema
} from "@app/shippin/services/secret-rotation-v2/snowflake-user-key-pair";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerSnowflakeUserKeyPairRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.SnowflakeUserKeyPair,
    server,
    responseSchema: SnowflakeUserKeyPairRotationSchema,
    createSchema: CreateSnowflakeUserKeyPairRotationSchema,
    updateSchema: UpdateSnowflakeUserKeyPairRotationSchema,
    generatedCredentialsSchema: SnowflakeUserKeyPairRotationGeneratedCredentialsSchema
  });
