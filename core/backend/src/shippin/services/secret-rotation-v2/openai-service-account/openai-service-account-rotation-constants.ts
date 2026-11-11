import { SecretRotation } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-enums";
import { TSecretRotationV2ListItem } from "@app/shippin/services/secret-rotation-v2/secret-rotation-v2-types";
import { AppConnection } from "@app/services/app-connection/app-connection-enums";

export const OPENAI_SERVICE_ACCOUNT_ROTATION_LIST_OPTION: TSecretRotationV2ListItem = {
  name: "OpenAI Service Account",
  type: SecretRotation.OpenAIServiceAccount,
  connection: AppConnection.OpenAI,
  template: {
    secretsMapping: {
      apiKey: "OPENAI_API_KEY"
    }
  }
};
