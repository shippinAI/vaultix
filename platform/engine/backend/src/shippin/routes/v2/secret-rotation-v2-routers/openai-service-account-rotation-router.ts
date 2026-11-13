import {
  CreateOpenAIServiceAccountRotationSchema,
  OpenAIServiceAccountRotationGeneratedCredentialsSchema,
  OpenAIServiceAccountRotationSchema,
  UpdateOpenAIServiceAccountRotationSchema
} from "@app/shippin/services/secret-rotation-v2/openai-service-account";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerOpenAIServiceAccountRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.OpenAIServiceAccount,
    server,
    responseSchema: OpenAIServiceAccountRotationSchema,
    createSchema: CreateOpenAIServiceAccountRotationSchema,
    updateSchema: UpdateOpenAIServiceAccountRotationSchema,
    generatedCredentialsSchema: OpenAIServiceAccountRotationGeneratedCredentialsSchema
  });
