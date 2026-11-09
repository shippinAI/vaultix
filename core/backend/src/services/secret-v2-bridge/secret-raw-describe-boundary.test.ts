import { createMongoAbility, MongoAbility, RawRuleOf } from "@casl/ability";

import { SecretType } from "@app/db/schemas";
import {
  ProjectPermissionSecretActions,
  ProjectPermissionSet,
  ProjectPermissionSub
} from "@app/ee/services/permission/project-permission";
import { inMemoryKeyStore } from "@app/keystore/memory";
import { conditionsMatcher } from "@app/lib/casl";
import { ForbiddenRequestError } from "@app/lib/errors";
import { ActorType } from "@app/services/auth/auth-type";
import { PersonalOverridesBehavior, SecretImportReferencesBehavior } from "@app/services/secret/secret-types";

import { secretV2BridgeServiceFactory } from "./secret-v2-bridge-service";

vi.mock("@app/lib/config/env", () => ({
  getConfig: () => ({ OTEL_TELEMETRY_COLLECTION_ENABLED: false })
}));

const actor = {
  actor: ActorType.IDENTITY,
  actorId: "identity",
  actorOrgId: "organization",
  actorAuthMethod: null,
  projectId: "project"
};

const abilityFor = (actions: ProjectPermissionSecretActions[]) =>
  createMongoAbility<ProjectPermissionSet>(
    actions.map(
      (action) =>
        ({
          action: [action],
          subject: ProjectPermissionSub.Secrets,
          inverted: false
        }) as RawRuleOf<MongoAbility<ProjectPermissionSet>>
    ),
    { conditionsMatcher }
  );

const planted = "CANARY-VALUE";

const build = (permission: MongoAbility<ProjectPermissionSet>, permissionError?: Error) => {
  const decryptor = vi.fn(() => planted);
  const findByFolderIds = vi.fn().mockResolvedValue([
    {
      id: "secret-1",
      key: "DATABASE_URL",
      folderId: "folder-1",
      type: SecretType.Shared,
      userId: null,
      tags: [],
      version: 2,
      encryptedValue: "ciphertext",
      encryptedComment: null,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    }
  ]);
  const findBySecretPath = vi.fn().mockResolvedValue({ id: "folder-1" });
  const getProjectPermission = vi.fn(async () => {
    if (permissionError) throw permissionError;
    return { permission };
  });
  const service = secretV2BridgeServiceFactory({
    secretDAL: { findByFolderIds } as never,
    projectDAL: {} as never,
    projectEnvDAL: {} as never,
    secretTagDAL: {} as never,
    secretVersionDAL: {} as never,
    folderCommitService: {} as never,
    folderDAL: { findBySecretPath } as never,
    permissionService: { getProjectPermission } as never,
    permissionDAL: { getPermissionFingerprint: vi.fn().mockResolvedValue("fingerprint") } as never,
    secretQueueService: {} as never,
    secretImportDAL: {} as never,
    secretVersionTagDAL: {} as never,
    secretApprovalPolicyService: {} as never,
    secretApprovalRequestDAL: {} as never,
    secretApprovalRequestSecretDAL: {} as never,
    kmsService: {
      createCipherPairWithDataKey: vi.fn().mockResolvedValue({ decryptor, encryptor: vi.fn() })
    } as never,
    resourceMetadataDAL: {} as never,
    keyStore: inMemoryKeyStore(),
    reminderService: {} as never,
    reminderDAL: {} as never,
    secretValidationRuleService: {} as never,
    projectFolderGrantDAL: {} as never,
    orgDAL: {} as never,
    licenseService: {} as never
  });
  return { service, decryptor, findByFolderIds, findBySecretPath };
};

const read = (service: ReturnType<typeof build>["service"]) =>
  service.getSecrets({
    ...actor,
    path: "/",
    environment: "dev",
    viewSecretValue: true,
    throwOnMissingReadValuePermission: true,
    personalOverridesBehavior: PersonalOverridesBehavior.IncludeAll,
    secretImportReferencesBehavior: SecretImportReferencesBehavior.SourceEnvironment
  });

describe("raw secret reads versus describe-only access", () => {
  test("describe-only access is denied before a secret value is decrypted", async () => {
    const { service, decryptor, findByFolderIds } = build(abilityFor([ProjectPermissionSecretActions.DescribeSecret]));
    let denied = false;
    try {
      await read(service);
    } catch (error) {
      denied = true;
      expect(JSON.stringify(error)).not.toContain(planted);
    }
    expect(denied).toBe(true);
    expect(decryptor).not.toHaveBeenCalled();
    expect(findByFolderIds).toHaveBeenCalled();
  });

  test("an actor with neither describe nor read permission does not load secrets", async () => {
    const { service, decryptor, findByFolderIds, findBySecretPath } = build(abilityFor([]));
    await expect(read(service)).rejects.toThrow();
    expect(findBySecretPath).not.toHaveBeenCalled();
    expect(findByFolderIds).not.toHaveBeenCalled();
    expect(decryptor).not.toHaveBeenCalled();
  });

  test("a foreign project denial does not load secrets", async () => {
    const { service, findByFolderIds, decryptor } = build(
      abilityFor([ProjectPermissionSecretActions.DescribeSecret, ProjectPermissionSecretActions.ReadValue]),
      new ForbiddenRequestError({ message: "This resource is unavailable." })
    );
    await expect(read(service)).rejects.toThrow(ForbiddenRequestError);
    expect(findByFolderIds).not.toHaveBeenCalled();
    expect(decryptor).not.toHaveBeenCalled();
  });
});
