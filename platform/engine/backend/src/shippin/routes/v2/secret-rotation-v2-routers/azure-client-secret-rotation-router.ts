import {
  AzureClientSecretRotationGeneratedCredentialsSchema,
  AzureClientSecretRotationSchema,
  CreateAzureClientSecretRotationSchema,
  UpdateAzureClientSecretRotationSchema
} from "@app/shippin/services/secret-rotation-v2/azure-client-secret";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerAzureClientSecretRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.AzureClientSecret,
    server,
    responseSchema: AzureClientSecretRotationSchema,
    createSchema: CreateAzureClientSecretRotationSchema,
    updateSchema: UpdateAzureClientSecretRotationSchema,
    generatedCredentialsSchema: AzureClientSecretRotationGeneratedCredentialsSchema
  });
