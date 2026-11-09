import { createMongoAbility, MongoAbility, RawRuleOf } from "@casl/ability";
import fastify from "fastify";

import { SecretType } from "@app/db/schemas";
import {
  ProjectPermissionSecretActions,
  ProjectPermissionSet,
  ProjectPermissionSub
} from "@app/ee/services/permission/project-permission";
import { inMemoryKeyStore } from "@app/keystore/memory";
import { conditionsMatcher } from "@app/lib/casl";
import { ForbiddenRequestError } from "@app/lib/errors";
import { fastifyErrHandler } from "@app/server/plugins/error-handler";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "@app/server/plugins/fastify-zod";
import { ActorType, AuthMode } from "@app/services/auth/auth-type";
import { secretServiceFactory } from "@app/services/secret/secret-service";
import { secretV2BridgeServiceFactory } from "@app/services/secret-v2-bridge/secret-v2-bridge-service";

import { registerDeprecatedSecretRouter } from "./deprecated-secret-router";

vi.mock("@app/lib/config/env", () => ({
  getConfig: () => ({ OTEL_TELEMETRY_COLLECTION_ENABLED: false })
}));

const planted = "CANARY-VALUE";
const clientProject = "client-supplied-project";
const actorProject = "project-in-actor-org";

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

describe("GET /api/v3/secrets/raw describe-only boundary", () => {
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
  const legacyFindByFolderIds = vi.fn().mockResolvedValue([{ secretValue: planted }]);
  const getProjectPermission = vi.fn(async () => ({
    permission: abilityFor([ProjectPermissionSecretActions.DescribeSecret])
  }));
  const extractProjectIdFromSlug = vi.fn(async () => actorProject);
  const bridge = secretV2BridgeServiceFactory({
    secretDAL: { findByFolderIds } as never,
    projectDAL: {} as never,
    projectEnvDAL: {} as never,
    secretTagDAL: {} as never,
    secretVersionDAL: {} as never,
    folderCommitService: {} as never,
    folderDAL: { findBySecretPath: vi.fn().mockResolvedValue({ id: "folder-1" }) } as never,
    permissionService: { getProjectPermission } as never,
    permissionDAL: { getPermissionFingerprint: vi.fn().mockResolvedValue("fingerprint") } as never,
    secretQueueService: {} as never,
    secretImportDAL: {} as never,
    secretVersionTagDAL: {} as never,
    secretApprovalPolicyService: {} as never,
    secretApprovalRequestDAL: {} as never,
    secretApprovalRequestSecretDAL: {} as never,
    kmsService: { createCipherPairWithDataKey: vi.fn().mockResolvedValue({ decryptor, encryptor: vi.fn() }) } as never,
    resourceMetadataDAL: {} as never,
    keyStore: inMemoryKeyStore(),
    reminderService: {} as never,
    reminderDAL: {} as never,
    secretValidationRuleService: {} as never,
    projectFolderGrantDAL: {} as never,
    orgDAL: {} as never,
    licenseService: {} as never
  });
  const getBotKey = vi.fn(async () => ({ shouldUseSecretV2Bridge: true, botKey: "unused" }));
  const secrets = secretServiceFactory({
    secretDAL: { findByFolderIds: legacyFindByFolderIds } as never,
    projectEnvDAL: {} as never,
    secretTagDAL: {} as never,
    secretVersionDAL: {} as never,
    folderDAL: { findBySecretPath: vi.fn() } as never,
    secretBlindIndexDAL: {} as never,
    permissionService: { getProjectPermission } as never,
    secretQueueService: {} as never,
    projectDAL: {} as never,
    projectBotService: { getBotKey } as never,
    secretImportDAL: {} as never,
    secretVersionTagDAL: {} as never,
    secretApprovalPolicyService: {} as never,
    secretApprovalRequestDAL: {} as never,
    secretApprovalRequestSecretDAL: {} as never,
    secretV2BridgeService: bridge,
    secretApprovalRequestService: {} as never,
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
  const app = fastify()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler)
    .withTypeProvider<ZodTypeProvider>();

  beforeAll(async () => {
    app.decorate("services", {
      project: { extractProjectIdFromSlug },
      secret: secrets,
      auditLog: { createAuditLog: vi.fn() },
      telemetry: { sendPostHogEvents: vi.fn() }
    } as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers.authorization !== "Bearer test-fixture") return;
      request.auth = {
        authMode: AuthMode.IDENTITY_ACCESS_TOKEN,
        actor: ActorType.IDENTITY
      } as typeof request.auth;
      request.permission = {
        type: ActorType.IDENTITY,
        id: "actor-from-auth",
        orgId: "org-from-auth",
        authMethod: null
      } as typeof request.permission;
    });
    await app.register(fastifyErrHandler);
    await app.register(registerDeprecatedSecretRouter, { prefix: "/api/v3/secrets" });
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectPermission.mockResolvedValue({
      permission: abilityFor([ProjectPermissionSecretActions.DescribeSecret])
    });
    extractProjectIdFromSlug.mockResolvedValue(actorProject);
    getBotKey.mockResolvedValue({ shouldUseSecretV2Bridge: true, botKey: "unused" });
  });

  const rawGet = (headers?: Record<string, string>, query = `workspaceId=${clientProject}&environment=dev`) =>
    app.inject({ method: "GET", url: `/api/v3/secrets/raw?${query}`, headers });

  test("describe-only identity is denied by the v3 raw route before decryption", async () => {
    const response = await rawGet({ authorization: "Bearer test-fixture" });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(planted);
    expect(decryptor).not.toHaveBeenCalled();
    expect(extractProjectIdFromSlug).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: clientProject,
        actorId: "actor-from-auth",
        actor: ActorType.IDENTITY,
        actorOrgId: "org-from-auth"
      })
    );
    expect(getBotKey).toHaveBeenCalledWith(actorProject);
    expect(getProjectPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "actor-from-auth",
        actorOrgId: "org-from-auth",
        projectId: actorProject
      })
    );
  });

  test("missing authentication never resolves a project or reads secrets", async () => {
    const response = await rawGet();
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(planted);
    expect(extractProjectIdFromSlug).not.toHaveBeenCalled();
    expect(getBotKey).not.toHaveBeenCalled();
    expect(findByFolderIds).not.toHaveBeenCalled();
  });

  test("a foreign project rejection does not read secrets", async () => {
    extractProjectIdFromSlug.mockRejectedValue(new ForbiddenRequestError({ message: "This resource is unavailable." }));
    const response = await rawGet({ authorization: "Bearer test-fixture" }, `workspaceId=${planted}&environment=dev`);
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(planted);
    expect(getBotKey).not.toHaveBeenCalled();
    expect(findByFolderIds).not.toHaveBeenCalled();
    expect(decryptor).not.toHaveBeenCalled();
  });

  test("an actor with neither describe nor read permission does not load secret rows", async () => {
    getProjectPermission.mockResolvedValue({ permission: abilityFor([]) });
    const response = await rawGet({ authorization: "Bearer test-fixture" });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(planted);
    expect(findByFolderIds).not.toHaveBeenCalled();
    expect(legacyFindByFolderIds).not.toHaveBeenCalled();
    expect(decryptor).not.toHaveBeenCalled();
  });

  test("the legacy raw branch also denies describe-only access before loading values", async () => {
    getBotKey.mockResolvedValue({ shouldUseSecretV2Bridge: false, botKey: "legacy-bot" });
    const response = await rawGet({ authorization: "Bearer test-fixture" });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(planted);
    expect(legacyFindByFolderIds).not.toHaveBeenCalled();
    expect(findByFolderIds).not.toHaveBeenCalled();
    expect(decryptor).not.toHaveBeenCalled();
  });
});
