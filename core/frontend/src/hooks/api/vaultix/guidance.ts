import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import { readGuidance } from "./guidance-contract";

export type { GuideId, GuideStep, VaultixGuide } from "./guidance-contract";
export { guideTargets, readGuidance } from "./guidance-contract";

export const useVaultixGuidance = () =>
  useQuery({
    queryKey: ["vaultix", "guidance"],
    queryFn: async () =>
      readGuidance((await apiRequest.get<unknown>("/api/v1/vaultix/guidance")).data)
  });
