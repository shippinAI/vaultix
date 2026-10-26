import { ActorType } from "@app/services/auth/auth-type";

import { vaultixFeatureServiceFactory } from "./feature-service";

describe("Vaultix feature service", () => {
  test("plan reads retain organization authorization", async () => {
    const getOrgPermission = vi.fn().mockRejectedValue(new Error("No organization access"));
    const service = vaultixFeatureServiceFactory({ permissionService: { getOrgPermission } });
    await expect(
      service.getOrgPlan({
        actor: ActorType.USER,
        actorId: "user-1",
        actorOrgId: "org-1",
        orgId: "org-2",
        rootOrgId: "org-2",
        actorAuthMethod: null
      })
    ).rejects.toThrow("No organization access");
    expect(getOrgPermission).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "user-1", actorOrgId: "org-1", orgId: "org-2" })
    );
  });
  test("local entitlement reads need no external services or credentials", async () => {
    const service = vaultixFeatureServiceFactory({ permissionService: { getOrgPermission: vi.fn() } });
    await service.init();
    expect(await service.getPlan("org-1")).toMatchObject({
      secretApproval: true,
      auditLogs: true,
      secretRotation: true
    });
    expect(await service.initializeBackgroundSync()).toBeUndefined();
    expect(service.getCustomerId()).toBeNull();
    await expect(service.startOrgTrial({} as Parameters<typeof service.startOrgTrial>[0])).rejects.toThrow("included");
  });
});
