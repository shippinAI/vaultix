import { registerSecretScanningEndpoints } from "@app/routes/v2/secret-scanning-v2-routers/secret-scanning-v2-endpoints";
import {
  BitbucketDataSourceSchema,
  CreateBitbucketDataSourceSchema,
  UpdateBitbucketDataSourceSchema
} from "@app/services/secret-scanning-v2/bitbucket";
import { SecretScanningDataSource } from "@app/services/secret-scanning-v2/secret-scanning-v2-enums";

export const registerBitbucketSecretScanningRouter = async (server: FastifyZodProvider) =>
  registerSecretScanningEndpoints({
    type: SecretScanningDataSource.Bitbucket,
    server,
    responseSchema: BitbucketDataSourceSchema,
    createSchema: CreateBitbucketDataSourceSchema,
    updateSchema: UpdateBitbucketDataSourceSchema
  });
