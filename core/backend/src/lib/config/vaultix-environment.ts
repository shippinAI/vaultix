import { resolveCacheEnvironment } from "./cache";

export const resolveVaultixEnvironment = (input: Record<string, unknown>) => ({
  ...resolveCacheEnvironment(input),
});
