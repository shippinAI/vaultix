import { OrganizationActionScope } from "@app/db/schemas/models";
import type { TLicenseServiceFactory } from "@app/ee/services/license/license-service";
import { InstanceType } from "@app/ee/services/license/license-types";
import type { TPermissionServiceFactory } from "@app/ee/services/permission/permission-service-types";
import { BadRequestError } from "@app/lib/errors";

import { getVaultixFeatures } from "./features";

export const vaultixFeatureServiceFactory = ({
  permissionService
}: {
  permissionService: Pick<TPermissionServiceFactory, "getOrgPermission">;
}): TLicenseServiceFactory => {
  const noBilling = async (): Promise<never> => {
    throw new BadRequestError({
      message: "Vaultix software features are included. A paid feature subscription is not required."
    });
  };
  return {
    init: async () => {},
    isValidLicense: true,
    getInstanceType: () => InstanceType.OnPrem,
    get onPremFeatures() {
      return getVaultixFeatures();
    },
    getPlan: async () => getVaultixFeatures(),
    getCustomerId: () => null,
    getLicenseId: () => "vaultix-included",
    getOrgPlan: async ({ actorId, actor, actorOrgId, actorAuthMethod, orgId }) => {
      await permissionService.getOrgPermission({
        actorId,
        actor,
        actorOrgId,
        actorAuthMethod,
        orgId,
        scope: OrganizationActionScope.Any
      });
      return getVaultixFeatures();
    },
    generateOrgCustomerId: async () => undefined,
    removeOrgCustomer: async () => {},
    invalidateGetPlan: async () => {},
    updateSubscriptionOrgMemberCount: async () => {},
    initializeBackgroundSync: async () => undefined,
    getOrgPlansTableByBillCycle: noBilling,
    startOrgTrial: noBilling,
    createOrganizationPortalSession: noBilling,
    getOrgBillingInfo: noBilling,
    getOrgPlanTable: noBilling,
    getOrgBillingDetails: noBilling,
    updateOrgBillingDetails: noBilling,
    addOrgPmtMethods: noBilling,
    delOrgPmtMethods: noBilling,
    getOrgPmtMethods: noBilling,
    getOrgLicenses: noBilling,
    getOrgTaxInvoices: noBilling,
    getOrgTaxIds: noBilling,
    addOrgTaxId: noBilling,
    delOrgTaxId: noBilling
  };
};
