import { OrganizationActionScope } from "@app/db/schemas/models";
import type { TPermissionServiceFactory } from "@app/shippin/services/permission/permission-service-types";
import type { TOrgPermission } from "@app/lib/types";

import { getVaultixFeatures } from "./features";

// Every software feature is included on every Vaultix deployment. Permissions and approvals still apply.
export const vaultixFeatureServiceFactory = ({
  permissionService
}: {
  permissionService: Pick<TPermissionServiceFactory, "getOrgPermission">;
}) => ({
  get onPremFeatures() {
    return getVaultixFeatures();
  },
  getPlan: async (_orgId?: string, _projectId?: string) => getVaultixFeatures(),
  getOrgPlan: async ({
    actorId,
    actor,
    actorOrgId,
    actorAuthMethod,
    orgId
  }: TOrgPermission & { rootOrgId?: string; refreshCache?: boolean }) => {
    await permissionService.getOrgPermission({
      actorId,
      actor,
      actorOrgId,
      actorAuthMethod,
      orgId,
      scope: OrganizationActionScope.Any
    });
    return getVaultixFeatures();
  }
});

export type TFeatureServiceFactory = ReturnType<typeof vaultixFeatureServiceFactory>;
