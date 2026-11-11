import {
  CreateDatadogApplicationKeySecretRotationSchema,
  DatadogApplicationKeySecretRotationGeneratedCredentialsSchema,
  DatadogApplicationKeySecretRotationSchema,
  UpdateDatadogApplicationKeySecretRotationSchema
} from "@app/shippin/services/secret-rotation-v2/datadog-application-key-secret";
import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";

import { registerSecretRotationEndpoints } from "./secret-rotation-v2-endpoints";

export const registerDatadogApplicationKeySecretRotationRouter = async (server: FastifyZodProvider) =>
  registerSecretRotationEndpoints({
    type: SecretRotation.DatadogApplicationKeySecret,
    server,
    responseSchema: DatadogApplicationKeySecretRotationSchema,
    createSchema: CreateDatadogApplicationKeySecretRotationSchema,
    updateSchema: UpdateDatadogApplicationKeySecretRotationSchema,
    generatedCredentialsSchema: DatadogApplicationKeySecretRotationGeneratedCredentialsSchema
  });
