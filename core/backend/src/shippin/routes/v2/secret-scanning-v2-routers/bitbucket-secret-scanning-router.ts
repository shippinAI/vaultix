import { registerSecretScanningEndpoints } from "@app/shippin/routes/v2/secret-scanning-v2-routers/secret-scanning-v2-endpoints";
import {
  BitbucketDataSourceSchema,
  CreateBitbucketDataSourceSchema,
  UpdateBitbucketDataSourceSchema
} from "@app/shippin/services/secret-scanning-v2/bitbucket";
import { SecretScanningDataSource } from "@app/shippin/services/secret-scanning-v2/secret-scanning-v2-enums";

export const registerBitbucketSecretScanningRouter = async (server: FastifyZodProvider) =>
  registerSecretScanningEndpoints({
    type: SecretScanningDataSource.Bitbucket,
    server,
    responseSchema: BitbucketDataSourceSchema,
    createSchema: CreateBitbucketDataSourceSchema,
    updateSchema: UpdateBitbucketDataSourceSchema
  });
