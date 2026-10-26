import { createMongoAbility, MongoAbility, RawRuleOf } from "@casl/ability";

import {
  ProjectPermissionSecretActions,
  ProjectPermissionSet,
  ProjectPermissionSub
} from "@app/ee/services/permission/project-permission";
import { conditionsMatcher } from "@app/lib/casl";
import { ActorType } from "@app/services/auth/auth-type";

import { vaultixReferenceServiceFactory } from "./reference-service";

const actor = { actor: ActorType.IDENTITY, actorId: "identity", actorOrgId: "organization", actorAuthMethod: null };
const query = { projectId: "project", environment: "dev", secretPath: "/app", offset: 0, limit: 2 };
const rows = [
  { id: "1", key: "ALLOWED", version: 1, tags: ["app"], createdAt: new Date(0), updatedAt: new Date(0) },
  { id: "2", key: "DENIED", version: 2, tags: ["private"], createdAt: new Date(0), updatedAt: new Date(0) },
  { id: "3", key: "NEXT_PAGE", version: 3, tags: ["app"], createdAt: new Date(0), updatedAt: new Date(0) }
];
const fixture = (rules: RawRuleOf<MongoAbility<ProjectPermissionSet>>[]) => {
  const permission = createMongoAbility<ProjectPermissionSet>(rules, { conditionsMatcher });
  const findBySecretPath = vi.fn().mockResolvedValue({ id: "folder" });
  const findReferencePage = vi.fn().mockResolvedValue(rows);
  const getProjectPermission = vi.fn().mockResolvedValue({ permission });
  const service = vaultixReferenceServiceFactory({
    permissionService: { getProjectPermission },
    projectService: { getProjects: vi.fn().mockResolvedValue([]) },
    folderDAL: { findBySecretPath },
    secretDAL: { findReferencePage }
  });
  return { service, findReferencePage, findBySecretPath, getProjectPermission };
};

describe("Vaultix reference authorization", () => {
  test.each([
    { environment: "dev", secretPath: "/app", secretName: "ALLOWED" },
    { environment: "dev", secretPath: "/app", secretTags: { $in: ["app"] } }
  ])("enforces scoped describe permission and removes permission tags: %j", async (conditions) => {
    const { service, getProjectPermission } = fixture([
      { action: ProjectPermissionSecretActions.DescribeSecret, subject: ProjectPermissionSub.Secrets, conditions }
    ]);
    const result = await service.listReferences(actor, query);
    expect(result.references.map((reference) => reference.name)).toEqual(["ALLOWED"]);
    expect(Object.keys(result.references[0]).sort()).toEqual(["createdAt", "id", "name", "updatedAt", "version"]);
    expect(result.nextOffset).toBe(2);
    expect(getProjectPermission).toHaveBeenCalledWith(
      expect.objectContaining({ ...actor, projectId: query.projectId })
    );
  });

  test("write access alone cannot load even reference metadata", async () => {
    const { service, findBySecretPath, findReferencePage } = fixture([
      { action: ProjectPermissionSecretActions.Edit, subject: ProjectPermissionSub.Secrets }
    ]);
    await expect(service.listReferences(actor, query)).rejects.toThrow();
    expect(findBySecretPath).not.toHaveBeenCalled();
    expect(findReferencePage).not.toHaveBeenCalled();
  });

  test("a denied page stays empty and preserves pagination for subsequent allowed names", async () => {
    const { service } = fixture([
      {
        action: ProjectPermissionSecretActions.DescribeSecret,
        subject: ProjectPermissionSub.Secrets,
        conditions: { environment: "prod" }
      }
    ]);
    const result = await service.listReferences(actor, query);
    expect(result.references).toEqual([]);
    expect(result.nextOffset).toBe(2);
  });
});
