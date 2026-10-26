import { resolveCacheEnvironment } from "./cache";

export const resolveVaultixEnvironment = (input: Record<string, unknown>) => ({
  ...resolveCacheEnvironment(input),
  LICENSE_SERVER_V2_MODE: "off",
  LICENSE_SERVER_URL: "",
  LICENSE_SERVER_KEY: "",
  LICENSE_SERVER_V2_SERVICE_KEY: "",
  LICENSE_KEY: "",
  LICENSE_KEY_OFFLINE: "",
  DISABLE_LICENSE_V1_CLOUD: "true"
});
