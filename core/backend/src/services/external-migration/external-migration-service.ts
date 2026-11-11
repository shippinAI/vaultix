import { ForbiddenError, subject } from "@casl/ability";

import { ActionProjectType, OrganizationActionScope, OrgMembershipRole } from "@app/db/schemas";
import {
  AuditLogInfo,
  EventType,
  SecretApprovalEvent,
  TAuditLogServiceFactory
} from "@app/shippin/services/audit-log/audit-log-types";
import { verifyHostInputValidity } from "@app/shippin/services/dynamic-secret/dynamic-secret-fns";
import { TGatewayDALFactory } from "@app/shippin/services/gateway/gateway-dal";
import { TGatewayServiceFactory } from "@app/shippin/services/gateway/gateway-service";
import { TGatewayPoolServiceFactory } from "@app/shippin/services/gateway-pool/gateway-pool-service";
import { TGatewayV2DALFactory } from "@app/shippin/services/gateway-v2/gateway-v2-dal";
import { TGatewayV2ServiceFactory } from "@app/shippin/services/gateway-v2/gateway-v2-service";
import { TPermissionServiceFactory } from "@app/shippin/services/permission/permission-service-types";
import { ProjectPermissionSecretActions, ProjectPermissionSub } from "@app/shippin/services/permission/project-permission";
import { TSecretApprovalPolicyServiceFactory } from "@app/shippin/services/secret-approval-policy/secret-approval-policy-service";
import { crypto } from "@app/lib/crypto/cryptography";
import { BadRequestError, ForbiddenRequestError, NotFoundError } from "@app/lib/errors";
import { GatewayVersion } from "@app/lib/gateway/types";
import { OrgServiceActor } from "@app/lib/types";

import { AppConnection } from "../app-connection/app-connection-enums";
import { TAppConnectionServiceFactory } from "../app-connection/app-connection-service";
import { TDopplerConnection } from "../app-connection/doppler";
import { listRemoteSecrets, TExternalVaultixConnection } from "../app-connection/external-vaultix";
import {
  convertVaultValueToString,
  getHCVaultAuthMounts,
  getHCVaultDatabaseRoles,
  getHCVaultInstanceUrl,
  getHCVaultKubernetesAuthRoles,
  getHCVaultKubernetesRoles,
  getHCVaultLdapRoles,
  getHCVaultSecretsForPaths,
  HCVaultAuthType,
  JsonValue,
  listHCVaultMounts,
  listHCVaultNamespaces,
  listHCVaultPolicies,
  listHCVaultSecretPaths,
  TGatewayDetails,
  THCVaultConnection
} from "../app-connection/hc-vault";
import { TSecretServiceFactory } from "../secret/secret-service";
import {
  PersonalOverridesBehavior,
  SecretImportReferencesBehavior,
  SecretProtectionType
} from "../secret/secret-types";
import { TUserDALFactory } from "../user/user-dal";
import {
  decryptEnvKeyDataFn,
  getDopplerSecrets,
  importVaultDataFn,
  listDopplerConfigs,
  listDopplerEnvironments,
  listDopplerProjects,
  parseEnvKeyDataFn,
  vaultMigrationTransformMappings
} from "./external-migration-fns";
import { TExternalMigrationQueueFactory } from "./external-migration-queue";
import { ExternalMigrationProviders } from "./external-migration-schemas";
import {
  ExternalMigrationImportStatus,
  ExternalPlatforms,
  THasCustomVaultMigrationDTO,
  TImportDopplerSecretsDTO,
  TImportEnvKeyDataDTO,
  TImportVaultDataDTO,
  TProviderImportDTO,
  TProviderImportSpecDTO
} from "./external-migration-types";
import {
  findStaleApprovedKeys,
  IMPORT_LIFECYCLE,
  IMPORT_PROVIDERS,
  isImportProvider,
  planProviderImport,
  TImportProvider,
  TImportSourceSecret
} from "./provider-import";

type TExternalMigrationServiceFactoryDep = {
  permissionService: TPermissionServiceFactory;
  secretService: TSecretServiceFactory;
  auditLogService: Pick<TAuditLogServiceFactory, "createAuditLog">;
  externalMigrationQueue: TExternalMigrationQueueFactory;
  appConnectionService: Pick<
    TAppConnectionServiceFactory,
    "connectAppConnectionById" | "validateAppConnectionUsageById" | "listAvailableAppConnectionsForUser"
  >;
  secretApprovalPolicyService: Pick<TSecretApprovalPolicyServiceFactory, "getSecretApprovalPolicy">;
  userDAL: Pick<TUserDALFactory, "findById">;
  gatewayService: Pick<TGatewayServiceFactory, "fnGetGatewayClientTlsByGatewayId">;
  gatewayV2Service: Pick<TGatewayV2ServiceFactory, "getPlatformConnectionDetailsByGatewayId">;
  gatewayDAL: Pick<TGatewayDALFactory, "find">;
  gatewayV2DAL: Pick<TGatewayV2DALFactory, "find">;
  gatewayPoolService: Pick<
    TGatewayPoolServiceFactory,
    "resolveEffectiveGatewayId" | "resolveAttachableGatewayFromPool" | "pickRandomHealthyGateway"
  >;
};

export type TExternalMigrationServiceFactory = ReturnType<typeof externalMigrationServiceFactory>;

export const externalMigrationServiceFactory = ({
  permissionService,
  externalMigrationQueue,
  userDAL,
  gatewayService,
  gatewayV2Service,
  gatewayDAL,
  gatewayV2DAL,
  gatewayPoolService,
  secretService,
  auditLogService,
  appConnectionService,
  secretApprovalPolicyService
}: TExternalMigrationServiceFactoryDep) => {
  const getGatewayDetails = async (connection: THCVaultConnection) => {
    let gatewayDetails: TGatewayDetails | undefined;

    const effectiveGatewayId = await gatewayPoolService.resolveEffectiveGatewayId({
      gatewayId: connection.gatewayId,
      gatewayPoolId: connection.gatewayPoolId
    });

    if (effectiveGatewayId) {
      const instanceUrl = await getHCVaultInstanceUrl(connection);
      const url = new URL(instanceUrl);

      const [targetHost] = await verifyHostInputValidity({
        host: url.hostname,
        isGateway: true,
        isDynamicSecret: false
      });

      // eslint-disable-next-line no-nested-ternary
      const targetPort = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

      const gatewayV2Details = await gatewayV2Service.getPlatformConnectionDetailsByGatewayId({
        gatewayId: effectiveGatewayId,
        targetHost,
        targetPort
      });

      if (gatewayV2Details) {
        gatewayDetails = {
          gatewayVersion: GatewayVersion.V2,
          details: gatewayV2Details,
          target: {
            host: targetHost,
            port: targetPort
          }
        };
      } else {
        const gatewayV1Details = await gatewayService.fnGetGatewayClientTlsByGatewayId(effectiveGatewayId);
        if (gatewayV1Details) {
          gatewayDetails = {
            gatewayVersion: GatewayVersion.V1,
            details: gatewayV1Details,
            target: {
              host: targetHost,
              port: targetPort
            }
          };
        }
      }
    }

    return gatewayDetails;
  };

  const importEnvKeyData = async ({
    decryptionKey,
    encryptedJson,
    actor,
    actorId,
    actorOrgId,
    actorAuthMethod
  }: TImportEnvKeyDataDTO) => {
    if (crypto.isFipsModeEnabled()) {
      throw new BadRequestError({ message: "EnvKey migration is not supported when running in FIPS mode." });
    }

    const { hasRole } = await permissionService.getOrgPermission({
      actorId,
      actor,
      orgId: actorOrgId,
      actorOrgId,
      actorAuthMethod,
      scope: OrganizationActionScope.Any
    });
    if (!hasRole(OrgMembershipRole.Admin)) {
      throw new ForbiddenRequestError({ message: "Only admins can import data" });
    }

    const user = await userDAL.findById(actorId);
    const json = await decryptEnvKeyDataFn(decryptionKey, encryptedJson);
    const envKeyData = await parseEnvKeyDataFn(json);

    const stringifiedJson = JSON.stringify({
      data: envKeyData,
      actor,
      actorId,
      actorOrgId,
      actorAuthMethod
    });

    const encrypted = crypto.encryption().symmetric().encryptWithRootEncryptionKey(stringifiedJson);

    await externalMigrationQueue.startImport({
      actorId: user.id,
      orgId: actorOrgId,
      actorEmail: user.email!,
      importType: ExternalPlatforms.EnvKey,
      data: {
        ...encrypted
      }
    });
  };

  const importVaultData = async ({
    vaultAccessToken,
    vaultNamespace,
    mappingType,
    vaultUrl,
    gatewayId,
    gatewayPoolId,
    actor,
    actorId,
    actorOrgId,
    actorAuthMethod
  }: TImportVaultDataDTO) => {
    const { hasRole } = await permissionService.getOrgPermission({
      actorId,
      actor,
      orgId: actorOrgId,
      actorOrgId,
      actorAuthMethod,
      scope: OrganizationActionScope.Any
    });

    if (!hasRole(OrgMembershipRole.Admin)) {
      throw new ForbiddenRequestError({ message: "Only admins can import data" });
    }

    const user = await userDAL.findById(actorId);

    if (gatewayId && gatewayPoolId) {
      throw new BadRequestError({ message: "Cannot specify both a gateway and a gateway pool" });
    }

    let effectiveGatewayId: string | null = gatewayId ?? null;
    if (gatewayId) {
      const [gateway, gatewayV2] = await Promise.all([
        gatewayDAL.find({ id: gatewayId, orgId: actorOrgId }, { limit: 1 }),
        gatewayV2DAL.find({ id: gatewayId, orgId: actorOrgId }, { limit: 1 })
      ]);

      // Ensure gatewayId is part of the actor's org
      if (!gateway.length && !gatewayV2.length) {
        throw new NotFoundError({ message: `Gateway with ID ${gatewayId} not found` });
      }
    }

    if (gatewayPoolId) {
      await gatewayPoolService.resolveAttachableGatewayFromPool({
        poolId: gatewayPoolId,
        orgId: actorOrgId,
        actor: { type: actor, id: actorId, orgId: actorOrgId, authMethod: actorAuthMethod }
      });
      const picked = await gatewayPoolService.pickRandomHealthyGateway(gatewayPoolId);
      effectiveGatewayId = picked.id;
    }

    const vaultData = await importVaultDataFn(
      {
        vaultAccessToken,
        vaultNamespace,
        vaultUrl,
        mappingType,
        gatewayId: effectiveGatewayId ?? undefined,
        orgId: actorOrgId
      },
      {
        gatewayService,
        gatewayV2Service
      }
    );

    const stringifiedJson = JSON.stringify({
      data: vaultData,
      actor,
      actorId,
      actorOrgId,
      actorAuthMethod
    });

    const encrypted = crypto.encryption().symmetric().encryptWithRootEncryptionKey(stringifiedJson);

    await externalMigrationQueue.startImport({
      actorId: user.id,
      orgId: actorOrgId,
      actorEmail: user.email!,
      importType: ExternalPlatforms.Vault,
      data: {
        ...encrypted
      }
    });
  };

  const hasCustomVaultMigration = async ({
    actor,
    actorId,
    actorOrgId,
    actorAuthMethod,
    provider
  }: THasCustomVaultMigrationDTO) => {
    const { hasRole } = await permissionService.getOrgPermission({
      actorId,
      actor,
      orgId: actorOrgId,
      actorOrgId,
      actorAuthMethod,
      scope: OrganizationActionScope.Any
    });

    if (!hasRole(OrgMembershipRole.Admin)) {
      throw new ForbiddenRequestError({ message: "Only admins can check custom migration status" });
    }

    if (provider !== ExternalMigrationProviders.Vault) {
      throw new BadRequestError({
        message: "Invalid provider. Vault is the only supported provider for custom migrations."
      });
    }

    return actorOrgId in vaultMigrationTransformMappings;
  };

  const getVaultNamespaces = async ({ actor, connectionId }: { actor: OrgServiceActor; connectionId: string }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );
    return listHCVaultNamespaces(connection, gatewayService, gatewayV2Service);
  };

  const getVaultPolicies = async ({
    actor,
    namespace,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );

    const gatewayDetails = await getGatewayDetails(connection);

    return listHCVaultPolicies(namespace, connection, gatewayService, gatewayV2Service, gatewayDetails);
  };

  const getVaultMounts = async ({
    actor,
    namespace,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );

    const gatewayDetails = await getGatewayDetails(connection);

    return listHCVaultMounts(connection, gatewayService, gatewayV2Service, namespace, gatewayDetails);
  };

  const getVaultSecretPaths = async ({
    actor,
    namespace,
    mountPath,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    mountPath: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );

    const gatewayDetails = await getGatewayDetails(connection);

    return listHCVaultSecretPaths(namespace, connection, gatewayService, gatewayV2Service, mountPath, gatewayDetails);
  };

  const importVaultSecrets = async ({
    actor,
    projectId,
    environment,
    secretPath,
    vaultNamespace,
    vaultSecretPaths,
    connectionId,
    auditLogInfo
  }: {
    actor: OrgServiceActor;
    projectId: string;
    environment: string;
    secretPath: string;
    vaultNamespace: string;
    vaultSecretPaths: string[];
    connectionId: string;
    auditLogInfo: AuditLogInfo;
  }) => {
    const connection = (await appConnectionService.validateAppConnectionUsageById(
      AppConnection.HCVault,
      { connectionId, projectId },
      actor
    )) as THCVaultConnection;

    if (!vaultSecretPaths.length) {
      throw new BadRequestError({ message: "At least one Vault secret path is required" });
    }

    const uniqueVaultSecretPaths = Array.from(new Set(vaultSecretPaths));

    const secretsPerPath = await getHCVaultSecretsForPaths(
      vaultNamespace,
      uniqueVaultSecretPaths,
      connection,
      gatewayService,
      gatewayV2Service
    );

    const keyOrigins = new Map<string, string[]>();

    // build a map of secret keys to the paths they appear in
    for (const { vaultSecretPath, secrets } of secretsPerPath) {
      for (const secretKey of Object.keys(secrets)) {
        const paths = keyOrigins.get(secretKey);
        if (paths) {
          paths.push(vaultSecretPath);
        } else {
          keyOrigins.set(secretKey, [vaultSecretPath]);
        }
      }
    }

    const conflicts = [...keyOrigins.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([secretKey, paths]) => `"${secretKey}" (in ${paths.join(", ")})`);

    if (conflicts.length) {
      throw new BadRequestError({
        message: `Cannot import: the following secret keys appear in multiple selected Vault paths: ${conflicts.join("; ")}. Resolve the conflicts in Vault or import the paths separately.`
      });
    }

    const vaultSecrets: Record<string, JsonValue> = {};
    for (const { secrets } of secretsPerPath) {
      Object.assign(vaultSecrets, secrets);
    }

    try {
      const secretOperation = await secretService.createManySecretsRaw({
        actorId: actor.id,
        actor: actor.type,
        actorAuthMethod: actor.authMethod,
        actorOrgId: actor.orgId,
        secretPath,
        environment,
        projectId,
        secrets: Object.entries(vaultSecrets).map(([secretKey, secretValue]) => ({
          secretKey,
          secretValue: convertVaultValueToString(secretValue)
        }))
      });

      if (secretOperation.type === SecretProtectionType.Approval) {
        await auditLogService.createAuditLog({
          projectId,
          ...auditLogInfo,
          event: {
            type: EventType.SECRET_APPROVAL_REQUEST,
            metadata: {
              committedBy: secretOperation.approval.committerUserId,
              secretApprovalRequestId: secretOperation.approval.id,
              secretApprovalRequestSlug: secretOperation.approval.slug,
              secretPath,
              environment,
              secrets: Object.entries(vaultSecrets).map(([secretKey]) => ({
                secretKey
              })),
              eventType: SecretApprovalEvent.CreateMany
            }
          }
        });

        return { status: ExternalMigrationImportStatus.ApprovalRequired };
      }

      return { status: ExternalMigrationImportStatus.Imported };
    } catch (error) {
      throw new BadRequestError({
        message: `Failed to import Vault secrets. ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  };

  const getVaultAuthMounts = async ({
    actor,
    namespace,
    authType,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    authType?: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );
    return getHCVaultAuthMounts(namespace, authType as HCVaultAuthType, connection, gatewayService, gatewayV2Service);
  };

  const getVaultKubernetesAuthRoles = async ({
    actor,
    namespace,
    mountPath,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    mountPath: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );
    return getHCVaultKubernetesAuthRoles(namespace, mountPath, connection, gatewayService, gatewayV2Service);
  };

  const getVaultKubernetesRoles = async ({
    actor,
    namespace,
    mountPath,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    mountPath: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );
    return getHCVaultKubernetesRoles(namespace, mountPath, connection, gatewayService, gatewayV2Service);
  };

  const getVaultDatabaseRoles = async ({
    actor,
    namespace,
    mountPath,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    mountPath: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );
    return getHCVaultDatabaseRoles(namespace, mountPath, connection, gatewayService, gatewayV2Service);
  };

  const getVaultLdapRoles = async ({
    actor,
    namespace,
    mountPath,
    connectionId
  }: {
    actor: OrgServiceActor;
    namespace: string;
    mountPath: string;
    connectionId: string;
  }) => {
    const connection = await appConnectionService.connectAppConnectionById<THCVaultConnection>(
      AppConnection.HCVault,
      connectionId,
      actor
    );
    return getHCVaultLdapRoles(namespace, mountPath, connection, gatewayService, gatewayV2Service);
  };

  // ─── Doppler In-Platform Migration ──────────────────────────────────────────

  // CASL is enforced inside connectAppConnectionById for project- or org-scoped connections.
  const getDopplerConnection = (connectionId: string, actor: OrgServiceActor) =>
    appConnectionService.connectAppConnectionById<TDopplerConnection>(AppConnection.Doppler, connectionId, actor);

  const getDopplerConnectionForImport = (connectionId: string, projectId: string, actor: OrgServiceActor) =>
    appConnectionService.validateAppConnectionUsageById(
      AppConnection.Doppler,
      { connectionId, projectId },
      actor
    ) as Promise<TDopplerConnection>;

  const getDopplerProjects = async ({ connectionId, actor }: { connectionId: string; actor: OrgServiceActor }) => {
    const appConnection = await getDopplerConnection(connectionId, actor);
    return listDopplerProjects(appConnection);
  };

  const getDopplerEnvironments = async ({
    connectionId,
    projectSlug,
    actor
  }: {
    connectionId: string;
    projectSlug: string;
    actor: OrgServiceActor;
  }) => {
    const appConnection = await getDopplerConnection(connectionId, actor);
    return listDopplerEnvironments(appConnection, projectSlug);
  };

  const getDopplerConfigs = async ({
    connectionId,
    projectSlug,
    actor
  }: {
    connectionId: string;
    projectSlug: string;
    actor: OrgServiceActor;
  }) => {
    const appConnection = await getDopplerConnection(connectionId, actor);
    return listDopplerConfigs(appConnection, projectSlug);
  };

  const importDopplerSecrets = async ({
    connectionId,
    dopplerProject,
    dopplerEnvironment,
    targetProjectId,
    targetEnvironment,
    targetSecretPath,
    actor,
    auditLogInfo
  }: TImportDopplerSecretsDTO) => {
    const appConnection = await getDopplerConnectionForImport(connectionId, targetProjectId, actor);

    const dopplerSecrets = await getDopplerSecrets(appConnection, dopplerProject, dopplerEnvironment);

    try {
      const secretOperation = await secretService.createManySecretsRaw({
        actorId: actor.id,
        actor: actor.type,
        actorAuthMethod: actor.authMethod,
        actorOrgId: actor.orgId,
        projectId: targetProjectId,
        environment: targetEnvironment,
        secretPath: targetSecretPath,
        secrets: Object.entries(dopplerSecrets).map(([secretKey, secretValue]) => ({
          secretKey,
          secretValue
        }))
      });

      if (secretOperation.type === SecretProtectionType.Approval) {
        await auditLogService.createAuditLog({
          projectId: targetProjectId,
          ...auditLogInfo,
          event: {
            type: EventType.SECRET_APPROVAL_REQUEST,
            metadata: {
              committedBy: secretOperation.approval.committerUserId,
              secretApprovalRequestId: secretOperation.approval.id,
              secretApprovalRequestSlug: secretOperation.approval.slug,
              secretPath: targetSecretPath,
              environment: targetEnvironment,
              secrets: Object.entries(dopplerSecrets).map(([secretKey]) => ({
                secretKey
              })),
              eventType: SecretApprovalEvent.CreateMany
            }
          }
        });

        return { status: ExternalMigrationImportStatus.ApprovalRequired, imported: 0 };
      }
    } catch (error) {
      throw new BadRequestError({
        message: `Failed to import Doppler secrets. ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }

    return { status: ExternalMigrationImportStatus.Imported, imported: Object.keys(dopplerSecrets).length };
  };

  // ─── Provider import lifecycle: review → approve → import ───────────────────
  // Source values are read on the server and handed straight to the secret service. Review and
  // import responses carry key names, counts and policy state only.

  const listImportProviders = async ({ actor, projectId }: { actor: OrgServiceActor; projectId?: string }) =>
    Promise.all(
      IMPORT_PROVIDERS.map(async (provider) => {
        let connections: Array<{ id: string; name: string }> = [];
        let unavailableReason: string | null = null;
        try {
          const available = await appConnectionService.listAvailableAppConnectionsForUser(provider, actor, projectId);
          connections = available.map((connection) => ({ id: connection.id, name: connection.name }));
        } catch (error) {
          if (!(error instanceof ForbiddenError) && !(error instanceof ForbiddenRequestError)) throw error;
          unavailableReason = "You don't have permission to use app connections here.";
        }
        return {
          provider,
          connections,
          unavailableReason,
          lifecycle: [...IMPORT_LIFECYCLE],
          referenceSafe: true as const
        };
      })
    );

  const assertImportProvider = (provider: string): TImportProvider => {
    if (!isImportProvider(provider))
      throw new BadRequestError({ message: `Unsupported import provider '${provider}'` });
    return provider;
  };

  const readImportSource = async (
    provider: TImportProvider,
    connectionId: string,
    { source, target, actor }: Pick<TProviderImportSpecDTO, "source" | "target" | "actor">
  ): Promise<TImportSourceSecret[]> => {
    // Checks the connection is this provider's and usable from the destination project.
    const connection = await appConnectionService.validateAppConnectionUsageById(
      provider,
      { connectionId, projectId: target.projectId },
      actor
    );
    if (provider === AppConnection.Doppler) {
      const secrets = await getDopplerSecrets(connection as TDopplerConnection, source.project, source.environment);
      return Object.entries(secrets).map(([secretKey, secretValue]) => ({ secretKey, secretValue }));
    }
    return listRemoteSecrets(connection as TExternalVaultixConnection, {
      projectId: source.project,
      environment: source.environment,
      secretPath: source.secretPath
    });
  };

  const inspectImportTarget = async ({ target, actor }: Pick<TProviderImportSpecDTO, "target" | "actor">) => {
    const { permission } = await permissionService.getProjectPermission({
      actor: actor.type,
      actorId: actor.id,
      projectId: target.projectId,
      actorAuthMethod: actor.authMethod,
      actorOrgId: actor.orgId,
      actionProjectType: ActionProjectType.SecretManager
    });
    const [{ secrets }, policy] = await Promise.all([
      secretService.getSecretsRaw({
        projectId: target.projectId,
        environment: target.environment,
        path: target.secretPath,
        actor: actor.type,
        actorId: actor.id,
        actorOrgId: actor.orgId,
        actorAuthMethod: actor.authMethod,
        viewSecretValue: false,
        throwOnMissingReadValuePermission: false,
        personalOverridesBehavior: PersonalOverridesBehavior.NeverInclude,
        secretImportReferencesBehavior: SecretImportReferencesBehavior.Relative,
        includeImports: false,
        expandSecretReferences: false,
        recursive: false
      }),
      secretApprovalPolicyService.getSecretApprovalPolicy(target.projectId, target.environment, target.secretPath)
    ]);
    return {
      existingKeys: secrets.map((secret) => secret.secretKey),
      canCreate: (secretName: string) =>
        permission.can(
          ProjectPermissionSecretActions.Create,
          subject(ProjectPermissionSub.Secrets, {
            environment: target.environment,
            secretPath: target.secretPath,
            secretName,
            secretTags: []
          })
        ),
      policy
    };
  };

  const reviewProviderImport = async ({ provider, connectionId, source, target, actor }: TProviderImportSpecDTO) => {
    const importProvider = assertImportProvider(provider);
    const [sourceSecrets, destination] = await Promise.all([
      readImportSource(importProvider, connectionId, { source, target, actor }),
      inspectImportTarget({ target, actor })
    ]);
    const plan = planProviderImport({
      source: sourceSecrets,
      existingKeys: destination.existingKeys,
      canCreate: destination.canCreate
    });
    return {
      provider: importProvider,
      ...plan,
      approvalRequired: Boolean(destination.policy),
      approvalPolicyName: destination.policy?.name ?? null
    };
  };

  const importProviderSecrets = async ({
    provider,
    connectionId,
    source,
    target,
    actor,
    keys,
    auditLogInfo
  }: TProviderImportDTO) => {
    const importProvider = assertImportProvider(provider);
    const [sourceSecrets, destination] = await Promise.all([
      readImportSource(importProvider, connectionId, { source, target, actor }),
      inspectImportTarget({ target, actor })
    ]);
    const plan = planProviderImport({
      source: sourceSecrets,
      existingKeys: destination.existingKeys,
      canCreate: destination.canCreate
    });

    const stale = findStaleApprovedKeys(plan, keys);
    if (stale.length) {
      const listed = stale.slice(0, 10).join(", ");
      throw new BadRequestError({
        name: "StaleImportReview",
        message: `The source or destination changed since review: ${listed}${stale.length > 10 ? ", …" : ""}. Review the import again.`
      });
    }

    const approved = new Set(keys);
    const toImport = new Map<string, TImportSourceSecret>();
    for (const secret of sourceSecrets) {
      if (approved.has(secret.secretKey) && !toImport.has(secret.secretKey)) toImport.set(secret.secretKey, secret);
    }
    const skipped = plan.createCount - toImport.size;

    const operation = await secretService.createManySecretsRaw({
      actorId: actor.id,
      actor: actor.type,
      actorAuthMethod: actor.authMethod,
      actorOrgId: actor.orgId,
      projectId: target.projectId,
      environment: target.environment,
      secretPath: target.secretPath,
      secrets: [...toImport.values()].map((secret) => ({
        secretKey: secret.secretKey,
        secretValue: secret.secretValue,
        secretComment: secret.secretComment || undefined
      }))
    });

    if (operation.type === SecretProtectionType.Approval) {
      await auditLogService.createAuditLog({
        projectId: target.projectId,
        ...auditLogInfo,
        event: {
          type: EventType.SECRET_APPROVAL_REQUEST,
          metadata: {
            committedBy: operation.approval.committerUserId,
            secretApprovalRequestId: operation.approval.id,
            secretApprovalRequestSlug: operation.approval.slug,
            secretPath: target.secretPath,
            environment: target.environment,
            secrets: [...toImport.keys()].map((secretKey) => ({ secretKey })),
            eventType: SecretApprovalEvent.CreateMany
          }
        }
      });
      return {
        status: ExternalMigrationImportStatus.ApprovalRequired,
        imported: 0,
        skipped,
        approvalRequestId: operation.approval.id
      };
    }

    await auditLogService.createAuditLog({
      projectId: target.projectId,
      ...auditLogInfo,
      event: {
        type: EventType.CREATE_SECRETS,
        metadata: {
          environment: target.environment,
          secretPath: target.secretPath,
          secrets: operation.secrets.map((secret) => ({
            secretId: secret.id,
            secretKey: secret.secretKey,
            secretVersion: secret.version
          }))
        }
      }
    });

    return {
      status: ExternalMigrationImportStatus.Imported,
      imported: operation.secrets.length,
      skipped,
      approvalRequestId: null
    };
  };

  return {
    importEnvKeyData,
    importVaultData,
    hasCustomVaultMigration,

    getVaultNamespaces,
    getVaultPolicies,
    getVaultMounts,
    getVaultAuthMounts,
    getVaultSecretPaths,
    importVaultSecrets,
    getVaultKubernetesAuthRoles,
    getVaultKubernetesRoles,
    getVaultDatabaseRoles,
    getVaultLdapRoles,

    getDopplerProjects,
    getDopplerEnvironments,
    getDopplerConfigs,
    importDopplerSecrets,

    listImportProviders,
    reviewProviderImport,
    importProviderSecrets
  };
};
