import { ActionProjectType, ProjectType } from "@app/db/schemas/models";
import {
  hasSecretReadValueOrDescribePermission,
  throwIfMissingSecretReadValueOrDescribePermission
} from "@app/ee/services/permission/permission-fns";
import type { TPermissionServiceFactory } from "@app/ee/services/permission/permission-service-types";
import { ProjectPermissionSecretActions } from "@app/ee/services/permission/project-permission";
import { NotFoundError } from "@app/lib/errors";
import type { TProjectPermission } from "@app/lib/types";
import type { TProjectServiceFactory } from "@app/services/project/project-service";
import type { TSecretFolderDALFactory } from "@app/services/secret-folder/secret-folder-dal";
import type { TSecretV2BridgeDALFactory } from "@app/services/secret-v2-bridge/secret-v2-bridge-dal";

export type VaultixActor = Omit<TProjectPermission, "projectId">;
export type ReferenceQuery = {
  projectId: string;
  environment: string;
  secretPath: string;
  offset: number;
  limit: number;
};

export const vaultixReferenceServiceFactory = ({
  permissionService,
  projectService,
  folderDAL,
  secretDAL
}: {
  permissionService: Pick<TPermissionServiceFactory, "getProjectPermission">;
  projectService: Pick<TProjectServiceFactory, "getProjects">;
  folderDAL: Pick<TSecretFolderDALFactory, "findBySecretPath">;
  secretDAL: Pick<TSecretV2BridgeDALFactory, "findReferencePage">;
}) => ({
  listProjects: async (actor: VaultixActor) => {
    const projects = await projectService.getProjects({
      ...actor,
      includeRoles: false,
      type: ProjectType.SecretManager
    });
    return {
      narration: "These are the apps you can access in this organization.",
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        environments: project.environments.map((environment) => ({
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        }))
      }))
    };
  },
  listReferences: async (actor: VaultixActor, query: ReferenceQuery) => {
    const { permission } = await permissionService.getProjectPermission({
      ...actor,
      projectId: query.projectId,
      actionProjectType: ActionProjectType.SecretManager
    });
    throwIfMissingSecretReadValueOrDescribePermission(permission, ProjectPermissionSecretActions.DescribeSecret);
    const folder = await folderDAL.findBySecretPath(query.projectId, query.environment, query.secretPath);
    if (!folder) throw new NotFoundError({ message: "This secret folder is unavailable." });
    const rows = await secretDAL.findReferencePage({
      folderId: folder.id,
      offset: query.offset,
      limit: query.limit + 1
    });
    const page = rows.slice(0, query.limit);
    return {
      narration: "These secret names are safe to reference. Their values stay in your vault.",
      projectId: query.projectId,
      environment: query.environment,
      secretPath: query.secretPath,
      references: page
        .filter((row) =>
          hasSecretReadValueOrDescribePermission(permission, ProjectPermissionSecretActions.DescribeSecret, {
            environment: query.environment,
            secretPath: query.secretPath,
            secretName: row.key,
            secretTags: row.tags
          })
        )
        .map((row) => ({
          id: row.id,
          name: row.key,
          version: row.version,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null
    };
  }
});

export type VaultixReferenceService = ReturnType<typeof vaultixReferenceServiceFactory>;
