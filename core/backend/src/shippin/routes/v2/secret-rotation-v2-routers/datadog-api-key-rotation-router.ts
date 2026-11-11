import {
  CreateDatadogApiKeyRotationSchema,
  DatadogApiKeyRotationGeneratedCredentialsSchema,
  DatadogApiKeyRotationSchema,
  UpdateDatadogApiKeyRotationSchema
} from "@app/shippin/services/secret-rotation-v2/datadog-api-key";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerDatadogApiKeyRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.DatadogApiKey,
    server,
    responseSchema: DatadogApiKeyRotationSchema,
    createSchema: CreateDatadogApiKeyRotationSchema,
    updateSchema: UpdateDatadogApiKeyRotationSchema,
    generatedCredentialsSchema: DatadogApiKeyRotationGeneratedCredentialsSchema
  });
