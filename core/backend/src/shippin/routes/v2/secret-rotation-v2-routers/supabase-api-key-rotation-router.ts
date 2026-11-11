import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";
import {
  CreateSupabaseApiKeyRotationSchema,
  SupabaseApiKeyRotationGeneratedCredentialsSchema,
  SupabaseApiKeyRotationSchema,
  UpdateSupabaseApiKeyRotationSchema
} from "@app/shippin/services/secret-rotation-v2/supabase-api-key";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerSupabaseApiKeyRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.SupabaseApiKey,
    server,
    responseSchema: SupabaseApiKeyRotationSchema,
    createSchema: CreateSupabaseApiKeyRotationSchema,
    updateSchema: UpdateSupabaseApiKeyRotationSchema,
    generatedCredentialsSchema: SupabaseApiKeyRotationGeneratedCredentialsSchema
  });
