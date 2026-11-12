import {
  CreateOpenRouterApiKeyRotationSchema,
  OpenRouterApiKeyRotationGeneratedCredentialsSchema,
  OpenRouterApiKeyRotationSchema,
  UpdateOpenRouterApiKeyRotationSchema
} from "@app/shippin/services/secret-rotation-v2/open-router-api-key";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerOpenRouterApiKeyRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.OpenRouterApiKey,
    server,
    responseSchema: OpenRouterApiKeyRotationSchema,
    createSchema: CreateOpenRouterApiKeyRotationSchema,
    updateSchema: UpdateOpenRouterApiKeyRotationSchema,
    generatedCredentialsSchema: OpenRouterApiKeyRotationGeneratedCredentialsSchema
  });
