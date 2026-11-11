import { createMongoAbility, ForbiddenError, MongoAbility, RawRuleOf } from "@casl/ability";
import fastifyRequestContext, { requestContext } from "@fastify/request-context";
import fastify from "fastify";

import { ActionProjectType, SecretType } from "@app/db/schemas";
import { permissionServiceFactory } from "@app/ee/services/permission/permission-service";
import {
  ProjectPermissionSecretActions,
  ProjectPermissionSet,
  ProjectPermissionSub
} from "@app/ee/services/permission/project-permission";
import { conditionsMatcher } from "@app/lib/casl";
import { ForbiddenRequestError } from "@app/lib/errors";
import { RequestContextKey } from "@app/lib/request-context/request-context-keys";
import { ActorType } from "@app/services/auth/auth-type";
import { folderCommitServiceFactory } from "@app/services/folder-commit/folder-commit-service";
import { VAULTIX_SECRET_VALUE_HIDDEN_MASK } from "@app/services/secret/secret-fns";
import { secretServiceFactory } from "@app/services/secret/secret-service";
import { secretV2BridgeServiceFactory } from "@app/services/secret-v2-bridge/secret-v2-bridge-service";
import { vaultixTools } from "@app/services/vaultix/catalog";
import { referenceTools } from "@app/services/vaultix/reference-input";

vi.mock("@app/lib/config/env", () => ({
  getConfig: () => ({
    OTEL_TELEMETRY_COLLECTION_ENABLED: false,
    PARAMS_FOLDER_SECRET_DETECTION_ENABLED: false
  })
}));

const canary = "CANARY-VALUE";
let readableVersion = 1;
const projectId = "project-in-actor-org";
const actor = {
  actor: ActorType.IDENTITY,
  actorId: "actor-from-auth",
  actorOrgId: "org-from-auth",
  actorAuthMethod: null
} as const;

const abilityFor = (rules: RawRuleOf<MongoAbility<ProjectPermissionSet>>[]) =>
  createMongoAbility<ProjectPermissionSet>(rules, { conditionsMatcher });

const allow = (action: string) =>
  ({
    action: [action],
    subject: ProjectPermissionSub.Secrets,
    inverted: false
  }) as RawRuleOf<MongoAbility<ProjectPermissionSet>>;

const forbidCreateOnName = (secretName: string) =>
  ({
    action: [ProjectPermissionSecretActions.Create],
    subject: ProjectPermissionSub.Secrets,
    inverted: true,
    conditions: { secretName }
  }) as RawRuleOf<MongoAbility<ProjectPermissionSet>>;

const permission = (rules: RawRuleOf<MongoAbility<ProjectPermissionSet>>[]) => ({
  permission: abilityFor(rules),
  hasProjectEnforcement: () => false
});

describe("current TypeScript secret lifecycle", () => {
  const insertMany = vi.fn(async (rows: { key: string; version: number; encryptedValue?: Buffer }[]) =>
    rows.map((row) => ({
      id: "secret-1",
      key: row.key,
      version: row.version,
      type: SecretType.Shared,
      userId: null,
      folderId: "folder-1",
      tags: [],
      encryptedValue: row.encryptedValue
    }))
  );
  const versionInsertMany = vi.fn(async (rows: { version: number; encryptedValue?: Buffer }[]) =>
    rows.map((row) => ({ id: "version-1", type: SecretType.Shared, version: row.version }))
  );
  const bulkUpdate = vi.fn(
    async (rows: { filter: { id: string }; data: { key?: string; encryptedValue?: Buffer } }[]) =>
      rows.map((row) => ({
        id: row.filter.id,
        key: row.data.key,
        version: 2,
        type: SecretType.Shared,
        userId: null,
        folderId: "folder-1",
        tags: [],
        encryptedValue: row.data.encryptedValue,
        skipMultilineEncoding: false
      }))
  );
  const findBySecretPath = vi.fn().mockResolvedValue({
    id: "folder-1",
    envId: "env-1",
    environment: { slug: "dev", name: "Development" }
  });
  const findOne = vi.fn();
  const transaction = vi.fn(async (fn: (tx: object) => Promise<unknown>) => fn({}));
  const getProjectPermission = vi.fn(async () =>
    permission([allow(ProjectPermissionSecretActions.Create), allow(ProjectPermissionSecretActions.Edit)])
  );
  const decryptor = vi.fn(() => Buffer.from(canary));
  const bridge = secretV2BridgeServiceFactory({
    secretDAL: {
      findOne,
      insertMany,
      bulkUpdate,
      transaction,
      upsertSecretReferences: vi.fn(),
      invalidateSecretCacheByProjectId: vi.fn(),
      find: vi.fn(async (query: { $in?: unknown }) =>
        query?.$in
          ? [
              {
                id: "secret-1",
                key: "CANARY_NAME",
                version: readableVersion,
                type: SecretType.Shared,
                userId: null,
                folderId: "folder-1",
                tags: []
              }
            ]
          : []
      )
    } as never,
    projectDAL: { findById: vi.fn().mockResolvedValue({ id: projectId, secretDetectionIgnoreValues: [] }) } as never,
    projectEnvDAL: {} as never,
    secretTagDAL: { find: vi.fn().mockResolvedValue([]) } as never,
    secretVersionDAL: { insertMany: versionInsertMany } as never,
    folderCommitService: { createCommit: vi.fn() } as never,
    folderDAL: { findBySecretPath } as never,
    permissionService: { getProjectPermission } as never,
    permissionDAL: {} as never,
    secretQueueService: { syncSecrets: vi.fn() } as never,
    secretImportDAL: {} as never,
    secretVersionTagDAL: { insertMany: vi.fn() } as never,
    secretApprovalPolicyService: {} as never,
    secretApprovalRequestDAL: {} as never,
    secretApprovalRequestSecretDAL: {} as never,
    kmsService: {
      createCipherPairWithDataKey: vi.fn().mockResolvedValue({
        encryptor: ({ plainText }: { plainText: Buffer }) => ({
          cipherTextBlob: Buffer.from(`enc:${plainText.length}`)
        }),
        decryptor,
        generateSecretBlindIndex: vi.fn().mockResolvedValue("blind-index")
      })
    } as never,
    resourceMetadataDAL: { insertMany: vi.fn(), delete: vi.fn() } as never,
    keyStore: { getItem: vi.fn().mockResolvedValue(null), setItemWithExpiry: vi.fn() } as never,
    reminderService: {} as never,
    reminderDAL: {} as never,
    secretValidationRuleService: { validateSecrets: vi.fn() } as never,
    projectFolderGrantDAL: {} as never,
    orgDAL: {} as never,
    licenseService: {} as never
  });

  beforeEach(() => {
    vi.clearAllMocks();
    readableVersion = 1;
    findOne.mockResolvedValue(undefined);
    getProjectPermission.mockResolvedValue(
      permission([allow(ProjectPermissionSecretActions.Create), allow(ProjectPermissionSecretActions.Edit)])
    );
  });

  const createInput = {
    ...actor,
    projectId,
    environment: "dev",
    secretPath: "/",
    secretName: "CANARY_NAME",
    type: SecretType.Shared,
    secretValue: canary,
    secretComment: ""
  };

  test("a shared create stores version 1 ciphertext and does not put the value in the write error path", async () => {
    const created = await bridge.createSecret(createInput);
    expect(created.version).toBe(1);
    expect(created.secretKey).toBe("CANARY_NAME");
    const inserted = insertMany.mock.calls[0][0][0];
    expect(inserted.version).toBe(1);
    expect(Buffer.isBuffer(inserted.encryptedValue)).toBe(true);
    expect(inserted.encryptedValue.toString()).not.toContain(canary);
    expect(versionInsertMany.mock.calls[0][0][0].version).toBe(1);
  });

  test("describe-only and a later create forbid both deny the write before storage", async () => {
    getProjectPermission.mockResolvedValue(permission([allow(ProjectPermissionSecretActions.DescribeSecret)]));
    await expect(bridge.createSecret(createInput)).rejects.toBeInstanceOf(ForbiddenError);
    getProjectPermission.mockResolvedValue(
      permission([allow(ProjectPermissionSecretActions.Create), forbidCreateOnName("CANARY_NAME")])
    );
    await expect(bridge.createSecret(createInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(insertMany).not.toHaveBeenCalled();
  });

  test("a permission rejection for another organization does not read the folder", async () => {
    getProjectPermission.mockRejectedValue(
      new ForbiddenRequestError({ message: "This project does not belong to your selected organization." })
    );
    await expect(bridge.createSecret(createInput)).rejects.toMatchObject({
      message: "This project does not belong to your selected organization."
    });
    expect(findBySecretPath).not.toHaveBeenCalled();
    expect(insertMany).not.toHaveBeenCalled();
  });

  test("an edit writes the next version through the incrementing update and keeps the value out of storage plaintext", async () => {
    findOne.mockResolvedValue({
      id: "secret-1",
      key: "CANARY_NAME",
      version: 1,
      type: SecretType.Shared,
      userId: null,
      folderId: "folder-1",
      tags: [],
      isHoneyTokenSecret: false,
      isRotatedSecret: false
    });
    readableVersion = 2;
    const updated = await bridge.updateSecret({ ...createInput, secretValue: canary });
    expect(bulkUpdate).toHaveBeenCalledOnce();
    const stored = bulkUpdate.mock.calls[0][0][0].data.encryptedValue as Buffer;
    expect(stored.toString()).not.toContain(canary);
    expect(versionInsertMany.mock.calls[0][0][0].version).toBe(2);
    expect(updated.version).toBe(2);
  });

  test("describe-only cannot edit or read the value back", async () => {
    getProjectPermission.mockResolvedValue(permission([allow(ProjectPermissionSecretActions.DescribeSecret)]));
    findOne.mockResolvedValue({
      id: "secret-1",
      key: "CANARY_NAME",
      version: 1,
      type: SecretType.Shared,
      tags: [],
      isHoneyTokenSecret: false,
      isRotatedSecret: false
    });
    await expect(bridge.updateSecret(createInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(bulkUpdate).not.toHaveBeenCalled();

    const readDecryptor = vi.fn(() => Buffer.from(canary));
    const kms = bridge as unknown as { createSecret: typeof bridge.createSecret };
    void kms;
    const reading = secretV2BridgeServiceFactory({
      secretDAL: {
        findOneWithTags: vi.fn().mockResolvedValue({
          id: "secret-1",
          key: "CANARY_NAME",
          version: 1,
          type: SecretType.Shared,
          userId: null,
          folderId: "folder-1",
          tags: [],
          encryptedValue: Buffer.from("ciphertext")
        })
      } as never,
      projectDAL: {} as never,
      projectEnvDAL: {} as never,
      secretTagDAL: {} as never,
      secretVersionDAL: {} as never,
      folderCommitService: {} as never,
      folderDAL: {
        findBySecretPath: vi.fn().mockResolvedValue({ id: "folder-1", envId: "env-1" })
      } as never,
      permissionService: { getProjectPermission } as never,
      permissionDAL: {} as never,
      secretQueueService: {} as never,
      secretImportDAL: {} as never,
      secretVersionTagDAL: {} as never,
      secretApprovalPolicyService: {} as never,
      secretApprovalRequestDAL: {} as never,
      secretApprovalRequestSecretDAL: {} as never,
      kmsService: {
        createCipherPairWithDataKey: vi.fn().mockResolvedValue({ decryptor: readDecryptor, encryptor: vi.fn() })
      } as never,
      resourceMetadataDAL: {} as never,
      keyStore: {} as never,
      reminderService: {} as never,
      reminderDAL: {} as never,
      secretValidationRuleService: {} as never,
      projectFolderGrantDAL: {} as never,
      orgDAL: {} as never,
      licenseService: {} as never
    });
    await expect(
      reading.getSecretByName({
        ...actor,
        projectId,
        environment: "dev",
        path: "/",
        type: SecretType.Shared,
        secretName: "CANARY_NAME",
        viewSecretValue: true,
        includeImports: false,
        expandSecretReferences: false
      })
    ).rejects.toMatchObject({
      name: "ForbiddenReadSecretError",
      message: "You do not have permission to view secret value on secret with name 'CANARY_NAME'"
    });
    expect(readDecryptor).not.toHaveBeenCalled();

    const maskedDecryptor = vi.fn(() => Buffer.from(canary));
    const masked = secretV2BridgeServiceFactory({
      secretDAL: {
        findOneWithTags: vi.fn().mockResolvedValue({
          id: "secret-1",
          key: "CANARY_NAME",
          version: 1,
          type: SecretType.Shared,
          userId: null,
          folderId: "folder-1",
          tags: [],
          encryptedValue: Buffer.from("ciphertext"),
          encryptedComment: Buffer.from("comment-ciphertext")
        })
      } as never,
      projectDAL: {} as never,
      projectEnvDAL: {} as never,
      secretTagDAL: {} as never,
      secretVersionDAL: {} as never,
      folderCommitService: {} as never,
      folderDAL: {
        findBySecretPath: vi.fn().mockResolvedValue({ id: "folder-1", envId: "env-1" })
      } as never,
      permissionService: {
        getProjectPermission: vi.fn(async () => permission([allow(ProjectPermissionSecretActions.DescribeSecret)]))
      } as never,
      permissionDAL: {} as never,
      secretQueueService: {} as never,
      secretImportDAL: {} as never,
      secretVersionTagDAL: {} as never,
      secretApprovalPolicyService: {} as never,
      secretApprovalRequestDAL: {} as never,
      secretApprovalRequestSecretDAL: {} as never,
      kmsService: {
        createCipherPairWithDataKey: vi.fn().mockResolvedValue({ decryptor: maskedDecryptor, encryptor: vi.fn() })
      } as never,
      resourceMetadataDAL: {} as never,
      keyStore: {} as never,
      reminderService: {} as never,
      reminderDAL: {} as never,
      secretValidationRuleService: {} as never,
      projectFolderGrantDAL: {} as never,
      orgDAL: {} as never,
      licenseService: {} as never
    });
    const hidden = await masked.getSecretByName({
      ...actor,
      projectId,
      environment: "dev",
      path: "/",
      type: SecretType.Shared,
      secretName: "CANARY_NAME",
      viewSecretValue: false,
      includeImports: false,
      expandSecretReferences: false
    });
    expect(maskedDecryptor).toHaveBeenCalled();
    expect(hidden.secretValue).toBe(VAULTIX_SECRET_VALUE_HIDDEN_MASK);
    expect(hidden.secretValueHidden).toBe(true);
    expect(hidden.secretComment).toBe(canary);
  });

  test("a caller allowed to read the value still receives the decrypted secret", async () => {
    const readDecryptor = vi.fn(() => Buffer.from(canary));
    const reading = secretV2BridgeServiceFactory({
      secretDAL: {
        findOneWithTags: vi.fn().mockResolvedValue({
          id: "secret-1",
          key: "CANARY_NAME",
          version: 1,
          type: SecretType.Shared,
          userId: null,
          folderId: "folder-1",
          tags: [],
          encryptedValue: Buffer.from("ciphertext")
        })
      } as never,
      projectDAL: {} as never,
      projectEnvDAL: {} as never,
      secretTagDAL: {} as never,
      secretVersionDAL: {} as never,
      folderCommitService: {} as never,
      folderDAL: {
        findBySecretPath: vi.fn().mockResolvedValue({ id: "folder-1", envId: "env-1" })
      } as never,
      permissionService: {
        getProjectPermission: vi.fn(async () =>
          permission([
            allow(ProjectPermissionSecretActions.DescribeSecret),
            allow(ProjectPermissionSecretActions.ReadValue)
          ])
        )
      } as never,
      permissionDAL: {} as never,
      secretQueueService: {} as never,
      secretImportDAL: {} as never,
      secretVersionTagDAL: {} as never,
      secretApprovalPolicyService: {} as never,
      secretApprovalRequestDAL: {} as never,
      secretApprovalRequestSecretDAL: {} as never,
      kmsService: {
        createCipherPairWithDataKey: vi.fn().mockResolvedValue({ decryptor: readDecryptor, encryptor: vi.fn() })
      } as never,
      resourceMetadataDAL: {} as never,
      keyStore: {} as never,
      reminderService: {} as never,
      reminderDAL: {} as never,
      secretValidationRuleService: {} as never,
      projectFolderGrantDAL: {} as never,
      orgDAL: {} as never,
      licenseService: {} as never
    });
    const secret = await reading.getSecretByName({
      ...actor,
      projectId,
      environment: "dev",
      path: "/",
      type: SecretType.Shared,
      secretName: "CANARY_NAME",
      viewSecretValue: true,
      includeImports: false,
      expandSecretReferences: false
    });
    expect(readDecryptor).toHaveBeenCalledOnce();
    expect(secret.secretValue).toBe(canary);
    expect(secret.secretValueHidden).toBe(false);
  });

  test("an approval policy records the pending create and does not store the secret", async () => {
    const generate = vi.fn().mockResolvedValue({ id: "approval-1", slug: "1" });
    const innerCreate = vi.fn();
    const secrets = secretServiceFactory({
      secretDAL: {} as never,
      projectEnvDAL: {} as never,
      secretTagDAL: {} as never,
      secretVersionDAL: {} as never,
      folderDAL: {} as never,
      secretBlindIndexDAL: {} as never,
      permissionService: {} as never,
      secretQueueService: {} as never,
      projectDAL: { findById: vi.fn().mockResolvedValue({ enforceCapitalization: false }) } as never,
      projectBotService: { getBotKey: vi.fn().mockResolvedValue({ shouldUseSecretV2Bridge: true }) } as never,
      secretImportDAL: {} as never,
      secretVersionTagDAL: {} as never,
      secretApprovalPolicyService: {
        getSecretApprovalPolicy: vi.fn().mockResolvedValue({ id: "policy-1" })
      } as never,
      secretApprovalRequestDAL: {} as never,
      secretApprovalRequestSecretDAL: {} as never,
      secretV2BridgeService: { createSecret: innerCreate } as never,
      secretApprovalRequestService: { generateSecretApprovalRequestV2Bridge: generate } as never,
      licenseService: {} as never,
      reminderService: {} as never,
      secretVersionV2DAL: {} as never,
      secretV2BridgeDAL: {} as never,
      kmsService: {} as never,
      userGroupMembershipDAL: {} as never,
      identityGroupMembershipDAL: {} as never,
      orgDAL: {} as never,
      projectFolderGrantDAL: {} as never
    });
    const result = await secrets.createSecretRaw({
      ...actor,
      actor: ActorType.USER,
      projectId,
      environment: "dev",
      secretPath: "/",
      secretName: "CANARY_NAME",
      type: SecretType.Shared,
      secretValue: canary,
      secretComment: ""
    });
    expect(result).toMatchObject({ type: "approval", approval: { id: "approval-1" } });
    expect(innerCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(canary);
    const pending = generate.mock.calls[0][0] as {
      data: { create: { secretValue: string }[] };
    };
    expect(pending.data.create[0].secretValue).toBe(canary);
  });

  test("restoring a commit requires rollback permission before older commits are read", async () => {
    const findCommitBefore = vi.fn();
    const commits = folderCommitServiceFactory({
      folderCommitDAL: {
        findById: vi.fn().mockResolvedValue({ id: "commit-1", folderId: "folder-1", commitId: 2 }),
        findCommitBefore
      } as never,
      folderCommitChangesDAL: {} as never,
      folderCheckpointDAL: {} as never,
      folderTreeCheckpointDAL: {} as never,
      folderCheckpointResourcesDAL: {} as never,
      userDAL: {} as never,
      identityDAL: {} as never,
      folderDAL: {
        findSecretPathByFolderIds: vi.fn().mockResolvedValue([{ environmentSlug: "dev", path: "/" }])
      } as never,
      folderVersionDAL: {} as never,
      secretVersionV2BridgeDAL: {} as never,
      projectDAL: {} as never,
      secretV2BridgeDAL: {} as never,
      folderTreeCheckpointResourcesDAL: {} as never,
      folderCommitQueueService: {} as never,
      permissionService: {
        getProjectPermission: vi
          .fn()
          .mockResolvedValue(permission([allow(ProjectPermissionSecretActions.DescribeSecret)]))
      } as never,
      kmsService: {} as never,
      secretTagDAL: {} as never,
      resourceMetadataDAL: {} as never
    });
    await expect(
      commits.revertCommitChanges({
        commitId: "commit-1",
        actor: ActorType.USER,
        actorId: "actor-from-auth",
        actorAuthMethod: null as never,
        actorOrgId: "org-from-auth",
        projectId
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(findCommitBefore).not.toHaveBeenCalled();
  });

  test("assumed authority is the permission actor, and a foreign project stops before membership", async () => {
    const seen: { actorId?: string; actorType?: string } = {};
    const permissions = permissionServiceFactory({
      permissionDAL: {
        getPermissionFingerprint: vi.fn().mockResolvedValue("fingerprint"),
        getPermission: vi.fn(async (args: { actorId: string; actorType: string }) => {
          seen.actorId = args.actorId;
          seen.actorType = args.actorType;
          return [];
        })
      } as never,
      serviceTokenDAL: {} as never,
      projectDAL: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: projectId, orgId: "org-from-auth", type: ActionProjectType.SecretManager })
      } as never,
      userDAL: {} as never,
      identityDAL: {} as never,
      keyStore: { getItem: vi.fn().mockResolvedValue(null), setItemWithExpiry: vi.fn() } as never,
      roleDAL: {} as never,
      additionalPrivilegeDAL: {} as never,
      groupDAL: {} as never
    });
    const app = fastify();
    await app.register(fastifyRequestContext);
    app.get("/assume", async () => {
      requestContext.set(RequestContextKey.AssumedPrivilegeDetails, {
        projectId,
        actorId: "assumed-identity",
        actorType: ActorType.IDENTITY,
        requesterId: "requester"
      });
      try {
        await permissions.getProjectPermission({
          actor: ActorType.USER,
          actorId: "requester",
          projectId,
          actorAuthMethod: null as never,
          actorOrgId: "org-from-auth",
          actionProjectType: ActionProjectType.SecretManager
        });
      } catch (error) {
        return { ...seen, error: error instanceof Error ? error.message : "unknown" };
      }
      return seen;
    });
    const assumed = await app.inject("/assume");
    expect(assumed.json()).toMatchObject({ actorId: "assumed-identity", actorType: ActorType.IDENTITY });

    const foreign = permissionServiceFactory({
      permissionDAL: { getPermission: vi.fn(), getPermissionFingerprint: vi.fn() } as never,
      serviceTokenDAL: {} as never,
      projectDAL: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: projectId, orgId: "other-org", type: ActionProjectType.SecretManager })
      } as never,
      userDAL: {} as never,
      identityDAL: {} as never,
      keyStore: { getItem: vi.fn().mockResolvedValue(null), setItemWithExpiry: vi.fn() } as never,
      roleDAL: {} as never,
      additionalPrivilegeDAL: {} as never,
      groupDAL: {} as never
    });
    await expect(
      foreign.getProjectPermission({
        actor: ActorType.USER,
        actorId: "requester",
        projectId,
        actorAuthMethod: null as never,
        actorOrgId: "org-from-auth",
        actionProjectType: ActionProjectType.SecretManager
      })
    ).rejects.toMatchObject({ message: "This project does not belong to your selected organization." });
  });

  test("core MCP tools do not change secrets", () => {
    const names = [...vaultixTools, ...referenceTools].map((tool) => tool.name);
    expect(names).toEqual([
      "vaultix.warp.list",
      "vaultix.auth.options.get",
      "vaultix.guidance.get",
      "vaultix.catalog.get",
      "vaultix.configure.show",
      "vaultix.connections.get",
      "vaultix.specialist.instructions",
      "vaultix.learning.profile.get",
      "vaultix.projects.list",
      "vaultix.secrets.references"
    ]);
  });
});
