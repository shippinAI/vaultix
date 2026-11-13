import {
  CreateLiteLLMApiKeyRotationSchema,
  LiteLLMApiKeyRotationGeneratedCredentialsSchema,
  LiteLLMApiKeyRotationSchema,
  UpdateLiteLLMApiKeyRotationSchema
} from "@app/shippin/services/secret-rotation-v2/litellm-api-key";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerLiteLLMApiKeyRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.LiteLLMApiKey,
    server,
    responseSchema: LiteLLMApiKeyRotationSchema,
    createSchema: CreateLiteLLMApiKeyRotationSchema,
    updateSchema: UpdateLiteLLMApiKeyRotationSchema,
    generatedCredentialsSchema: LiteLLMApiKeyRotationGeneratedCredentialsSchema
  });
