import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import { readVaultixGuide } from "./catalog-contract";

export type { VaultixSourceAction } from "./catalog-contract";
export const useVaultixGuide = () =>
  useQuery({
    queryKey: ["vaultix", "guide"],
    queryFn: async () => {
      const [catalog, configure] = await Promise.all([
        apiRequest.get<unknown>("/api/v1/vaultix/catalog"),
        apiRequest.get<unknown>("/api/v1/vaultix/configure")
      ]);
      return readVaultixGuide(catalog.data, configure.data);
    }
  });
