import { AccessScope, ProjectType } from "@app/db/schemas";
import { TFeatureServiceFactory } from "@app/services/vaultix/feature-service";
import { BadRequestError } from "@app/lib/errors";
import { requestMemoKeys } from "@app/lib/request-context/memo-keys";
import { requestMemoize } from "@app/lib/request-context/request-memoizer";
import { TProjectDALFactory } from "@app/services/project/project-dal";

// secretsTemporaryAccess gates temporary (time-bound) role assignment in Secret Management projects.
// It is ignored when null (no restriction); an explicit boolean enforces it, blocking temporary role
// assignment when false. No-op for org scope, non-Secret-Management projects, or permanent-only roles.
export const assertSecretsTemporaryAccessAllowed = async ({
  featureService,
  projectDAL,
  scope,
  projectId,
  orgId,
  roles
}: {
  featureService: Pick<TFeatureServiceFactory, "getPlan">;
  projectDAL: Pick<TProjectDALFactory, "findById">;
  scope: AccessScope;
  projectId?: string;
  orgId: string;
  roles: { isTemporary?: boolean }[];
}) => {
  if (scope !== AccessScope.Project || !projectId) {
    return;
  }
  if (!roles.some((role) => role.isTemporary)) {
    return;
  }

  const project = await requestMemoize(requestMemoKeys.projectFindById(projectId), () =>
    projectDAL.findById(projectId)
  );
  if (project?.type !== ProjectType.SecretManager) {
    return;
  }

  const plan = await featureService.getPlan(orgId);
  if (typeof plan.secretsTemporaryAccess === "boolean" && !plan.secretsTemporaryAccess) {
    throw new BadRequestError({
      message: "Temporary access is not available on your current plan. Please upgrade to continue."
    });
  }
};
