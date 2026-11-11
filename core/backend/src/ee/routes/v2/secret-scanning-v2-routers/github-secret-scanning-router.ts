import { registerSecretScanningEndpoints } from "@app/routes/v2/secret-scanning-v2-routers/secret-scanning-v2-endpoints";
import {
  CreateGitHubDataSourceSchema,
  GitHubDataSourceSchema,
  UpdateGitHubDataSourceSchema
} from "@app/services/secret-scanning-v2/github";
import { SecretScanningDataSource } from "@app/services/secret-scanning-v2/secret-scanning-v2-enums";

export const registerGitHubSecretScanningRouter = async (server: FastifyZodProvider) =>
  registerSecretScanningEndpoints({
    type: SecretScanningDataSource.GitHub,
    server,
    responseSchema: GitHubDataSourceSchema,
    createSchema: CreateGitHubDataSourceSchema,
    updateSchema: UpdateGitHubDataSourceSchema
  });
