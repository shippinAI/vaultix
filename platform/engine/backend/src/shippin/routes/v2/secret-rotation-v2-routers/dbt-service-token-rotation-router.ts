import {
  CreateDbtServiceTokenRotationSchema,
  DbtServiceTokenRotationGeneratedCredentialsSchema,
  DbtServiceTokenRotationSchema,
  UpdateDbtServiceTokenRotationSchema
} from "@app/shippin/services/secret-rotation-v2/dbt-service-token";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerDbtServiceTokenRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.DbtServiceToken,
    server,
    responseSchema: DbtServiceTokenRotationSchema,
    createSchema: CreateDbtServiceTokenRotationSchema,
    updateSchema: UpdateDbtServiceTokenRotationSchema,
    generatedCredentialsSchema: DbtServiceTokenRotationGeneratedCredentialsSchema
  });
