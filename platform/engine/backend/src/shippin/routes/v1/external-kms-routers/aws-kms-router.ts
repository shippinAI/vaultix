import { ExternalKmsAwsSchema, KmsProviders } from "@app/shippin/services/external-kms/providers/model";

import { registerExternalKmsEndpoints } from "./external-kms-endpoints";

export const registerAwsKmsRouter = async (server: FastifyZodProvider) => {
  registerExternalKmsEndpoints({
    server,
    provider: KmsProviders.Aws,
    createSchema: ExternalKmsAwsSchema,
    updateSchema: ExternalKmsAwsSchema.partial()
  });
};
