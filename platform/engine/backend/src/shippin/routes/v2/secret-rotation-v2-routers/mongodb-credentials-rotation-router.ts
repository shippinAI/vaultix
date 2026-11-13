import {
  CreateMongoDBCredentialsRotationSchema,
  MongoDBCredentialsRotationGeneratedCredentialsSchema,
  MongoDBCredentialsRotationSchema,
  UpdateMongoDBCredentialsRotationSchema
} from "@app/shippin/services/secret-rotation-v2/mongodb-credentials";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerMongoDBCredentialsRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.MongoDBCredentials,
    server,
    responseSchema: MongoDBCredentialsRotationSchema,
    createSchema: CreateMongoDBCredentialsRotationSchema,
    updateSchema: UpdateMongoDBCredentialsRotationSchema,
    generatedCredentialsSchema: MongoDBCredentialsRotationGeneratedCredentialsSchema
  });
