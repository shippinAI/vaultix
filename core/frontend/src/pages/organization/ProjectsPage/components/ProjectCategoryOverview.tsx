import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { createNotification } from "@app/components/notifications";
import { CertManagerNotConfiguredModal } from "@app/components/projects/CertManagerNotConfiguredModal";
import { CertManagerSelectInstanceModal } from "@app/components/projects/CertManagerSelectInstanceModal";
import { RequestProjectAccessModal } from "@app/components/projects/RequestProjectAccessModal";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  Skeleton
} from "@app/components/v3";
import { useOrganization, useOrgPermission } from "@app/context";
import {
  OrgPermissionAdminConsoleAction,
  OrgPermissionProjectActions,
  OrgPermissionSubjects
} from "@app/context/OrgPermissionContext/types";
import {
  getCertManagerActiveProjectCookie,
  setCertManagerActiveProjectCookie
} from "@app/helpers/certManagerActiveProject";
import {
  getProjectDescription,
  getProjectLucideIcon,
  getProjectTitle,
  projectTypeToUrlSlug
} from "@app/helpers/project";
import { useGetOrgProductStats, useGetUserProjects } from "@app/hooks/api";
import { useCertManagerInstanceState } from "@app/hooks/api/certManagerInstance";
import { useOrgAdminAccessProject } from "@app/hooks/api/orgAdmin/mutation";
import { resolvePamProjectId } from "@app/hooks/api/pam/queries";
import { Project, ProjectType } from "@app/hooks/api/projects/types";

type ActiveProducts = ProjectType;

const PRODUCT_TYPES: ActiveProducts[] = [
  ProjectType.SecretManager,
  ProjectType.CertificateManager,
  ProjectType.KMS,
  ProjectType.SecretScanning,
  ProjectType.PAM
];

const PRODUCT_STYLES: Record<
  ActiveProducts,
  {
    iconClassName: string;
    containerClassName: string;
    cardClassName: string;
    titleUnderlineClassName: string;
  }
> = {
  [ProjectType.SecretManager]: {
    iconClassName: "h-4.5 w-4.5 text-product-sm",
    containerClassName: "border-product-sm/30 bg-product-sm/10",
    cardClassName: "hover:bg-container-hover",
    titleUnderlineClassName: "decoration-product-sm/60"
  },
  [ProjectType.CertificateManager]: {
    iconClassName: "h-4.5 w-4.5 text-product-pki",
    containerClassName: "border-product-pki/30 bg-product-pki/10",
    cardClassName: "hover:bg-container-hover",
    titleUnderlineClassName: "decoration-product-pki/60"
  },
  [ProjectType.KMS]: {
    iconClassName: "h-4.5 w-4.5 text-product-kms",
    containerClassName: "border-product-kms/30 bg-product-kms/10",
    cardClassName: "hover:bg-container-hover",
    titleUnderlineClassName: "decoration-product-kms/60"
  },
  [ProjectType.SecretScanning]: {
    iconClassName: "h-4.5 w-4.5 text-product-ss",
    containerClassName: "border-product-ss/30 bg-product-ss/10",
    cardClassName: "hover:bg-container-hover",
    titleUnderlineClassName: "decoration-product-ss/60"
  },
  [ProjectType.PAM]: {
    iconClassName: "h-4.5 w-4.5 text-product-pam",
    containerClassName: "border-product-pam/30 bg-product-pam/10",
    cardClassName: "hover:bg-container-hover",
    titleUnderlineClassName: "decoration-product-pam/60"
  }
};

const formatNumber = (num: number): string => {
  return num.toLocaleString();
};

type ProductStat = {
  label: string;
  value: number;
};

export const ProjectCategoryOverview = () => {
  const navigate = useNavigate();
  const { currentOrg } = useOrganization();
  const { permission } = useOrgPermission();
  const canRequestAccess = permission.can(
    OrgPermissionProjectActions.RequestAccess,
    OrgPermissionSubjects.Project
  );
  const projectsQuery = useGetUserProjects();
  const { data: projects = [], isPending: isProjectsLoading } = projectsQuery;
  const certManagerQuery = useCertManagerInstanceState();
  const { data: certManagerInstance } = certManagerQuery;
  const statsQuery = useGetOrgProductStats(currentOrg?.id ?? "");
  const { data: productStats } = statsQuery;
  const orgAdminAccessProject = useOrgAdminAccessProject();

  const [isRequestAccessOpen, setIsRequestAccessOpen] = useState(false);
  const [isCertManagerSetupOpen, setIsCertManagerSetupOpen] = useState(false);
  const [isCertManagerPickerOpen, setIsCertManagerPickerOpen] = useState(false);
  const [pendingCertManagerProjectId, setPendingCertManagerProjectId] = useState<string | null>(
    null
  );
  const [isPamRequestAccessOpen, setIsPamRequestAccessOpen] = useState(false);
  const [pendingPamProjectId, setPendingPamProjectId] = useState<string | null>(null);

  const orgDefaultCertManagerProjectId = certManagerInstance?.activeProjectId ?? null;
  const cmInstances = useMemo(
    () => certManagerInstance?.projects ?? [],
    [certManagerInstance?.projects]
  );

  const isOrgAdmin = permission.can(
    OrgPermissionAdminConsoleAction.AccessAllProjects,
    OrgPermissionSubjects.AdminConsole
  );
  const isCertManagerMember = useMemo(
    () => cmInstances.some((instance) => projects.some((project) => project.id === instance.id)),
    [cmInstances, projects]
  );
  const isCertManagerAccessBlocked =
    cmInstances.length > 0 && !isOrgAdmin && !canRequestAccess && !isCertManagerMember;

  const isPamMember = useMemo(
    () =>
      Boolean(
        currentOrg?.pamProjectId &&
          projects.some((project) => project.id === currentOrg.pamProjectId)
      ),
    [currentOrg?.pamProjectId, projects]
  );
  const isPamAccessBlocked =
    Boolean(currentOrg?.pamProjectId) && !isOrgAdmin && !canRequestAccess && !isPamMember;

  const certManagerActiveProjectId = useMemo(() => {
    const cookieValue = currentOrg?.id ? getCertManagerActiveProjectCookie(currentOrg.id) : null;
    if (cookieValue && cmInstances.some((p) => p.id === cookieValue)) return cookieValue;
    return orgDefaultCertManagerProjectId;
  }, [currentOrg?.id, cmInstances, orgDefaultCertManagerProjectId]);

  const certManagerActiveProject = useMemo(
    () =>
      certManagerActiveProjectId
        ? cmInstances.find((p) => p.id === certManagerActiveProjectId)
        : undefined,
    [cmInstances, certManagerActiveProjectId]
  );

  const getStatsForType = (type: ProjectType): ProductStat[] => {
    if (!productStats) return [];

    switch (type) {
      case ProjectType.SecretManager:
        return [
          { label: "secrets", value: productStats.secretManager.secretsCount },
          { label: "environments", value: productStats.secretManager.environmentsCount },
          { label: "projects", value: productStats.secretManager.projectsCount }
        ];
      case ProjectType.CertificateManager:
        return [
          { label: "certificates", value: productStats.certificateManager.certificatesCount },
          { label: "CAs", value: productStats.certificateManager.certificateAuthoritiesCount },
          { label: "signers", value: productStats.certificateManager.signersCount }
        ];
      case ProjectType.KMS:
        return [
          { label: "keys", value: productStats.kms.keysCount },
          { label: "clients", value: productStats.kms.clientsCount },
          { label: "projects", value: productStats.kms.projectsCount }
        ];
      case ProjectType.SecretScanning:
        return [
          { label: "data sources", value: productStats.secretScanning.dataSourcesCount },
          { label: "resources", value: productStats.secretScanning.resourcesCount },
          { label: "projects", value: productStats.secretScanning.projectsCount }
        ];
      case ProjectType.PAM:
        return [
          { label: "accounts", value: productStats.pam.accountsCount },
          { label: "account templates", value: productStats.pam.accountTemplatesCount },
          { label: "folders", value: productStats.pam.foldersCount }
        ];
      default:
        return [];
    }
  };

  const navigateToCertManager = (projectId: string) => {
    navigate({
      to: "/organizations/$orgId/projects/cert-manager/$projectId/overview",
      params: { orgId: currentOrg?.id ?? "", projectId }
    });
  };

  const enterCertManagerProject = async (projectId: string) => {
    setPendingCertManagerProjectId(projectId);
    const isMember = projects.some((p) => p.id === projectId);
    if (isMember) {
      navigateToCertManager(projectId);
      return;
    }
    if (isOrgAdmin) {
      try {
        await orgAdminAccessProject.mutateAsync({ projectId });
        navigateToCertManager(projectId);
      } catch (err) {
        createNotification({
          type: "error",
          text:
            err instanceof Error ? err.message : "Failed to join the Certificate Manager project."
        });
      }
    } else if (canRequestAccess) {
      setIsRequestAccessOpen(true);
    } else {
      createNotification({
        type: "error",
        text: "You don't have access to this Certificate Manager project."
      });
    }
  };

  const handleCertManagerInstanceSelect = async (projectId: string) => {
    if (currentOrg?.id) setCertManagerActiveProjectCookie(currentOrg.id, projectId);
    setIsCertManagerPickerOpen(false);
    await enterCertManagerProject(projectId);
  };

  const navigateToPam = () => {
    navigate({
      to: "/organizations/$orgId/pam/access",
      params: { orgId: currentOrg?.id ?? "" }
    });
  };

  const enterPamProject = async () => {
    // Also lazily bootstraps the PAM project for orgs that don't have one yet.
    let pamProjectId: string;
    try {
      pamProjectId = await resolvePamProjectId(currentOrg?.pamProjectId);
    } catch (err) {
      createNotification({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to resolve the Privileged Access Manager project."
      });
      return;
    }

    const isMember = projects.some((p) => p.id === pamProjectId);
    if (isMember) {
      navigateToPam();
      return;
    }

    setPendingPamProjectId(pamProjectId);

    if (isOrgAdmin) {
      try {
        await orgAdminAccessProject.mutateAsync({ projectId: pamProjectId });
        navigateToPam();
      } catch (err) {
        createNotification({
          type: "error",
          text:
            err instanceof Error
              ? err.message
              : "Failed to join the Privileged Access Manager project."
        });
      }
    } else if (canRequestAccess) {
      setIsPamRequestAccessOpen(true);
    } else {
      createNotification({
        type: "error",
        text: "You don't have access to Privileged Access Manager."
      });
    }
  };

  const handleTileClick = async (type: ProjectType) => {
    const orgId = currentOrg?.id || "";

    if (type === ProjectType.CertificateManager) {
      // A pending or failed lookup does not mean that no instance exists.
      if (certManagerQuery.isPending || certManagerQuery.isError) return;
      if (cmInstances.length === 0) {
        setIsCertManagerSetupOpen(true);
        return;
      }
      if (cmInstances.length > 1) {
        setIsCertManagerPickerOpen(true);
        return;
      }
      const onlyId = cmInstances[0].id;
      await enterCertManagerProject(onlyId);
      return;
    }

    if (type === ProjectType.PAM) {
      await enterPamProject();
      return;
    }

    navigate({
      to: "/organizations/$orgId/projects/$type",
      params: { orgId, type: projectTypeToUrlSlug(type) }
    });
  };

  if (projectsQuery.isError) {
    return (
      <Alert variant="danger">
        <AlertTitle>Could Not Load Your Projects</AlertTitle>
        <AlertDescription>
          Your project access could not be checked. Retry to load the Vaultix workspace.
          <Button
            variant="outline"
            isPending={projectsQuery.isFetching}
            onClick={() => projectsQuery.refetch()}
          >
            Retry Projects
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isProjectsLoading) {
    return (
      <div
        role="status"
        aria-label="Loading Vaultix products"
        className="grid grid-cols-1 gap-5 lg:grid-cols-2"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={`tile-loading-${i + 1}`}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <Skeleton className="h-9 w-9 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-3 w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const requestAccessTarget =
    (pendingCertManagerProjectId
      ? cmInstances.find((p) => p.id === pendingCertManagerProjectId)
      : undefined) ?? certManagerActiveProject;
  const requestAccessProject: Project | undefined = requestAccessTarget
    ? ({
        id: requestAccessTarget.id,
        name: requestAccessTarget.name
      } as Project)
    : undefined;

  const pamRequestAccessProject: Project | undefined = pendingPamProjectId
    ? ({
        id: pendingPamProjectId,
        name: "Privileged Access Manager"
      } as Project)
    : undefined;

  return (
    <>
      {certManagerQuery.isError && (
        <Alert variant="danger" className="mb-5">
          <AlertTitle>Could Not Load Certificate Manager</AlertTitle>
          <AlertDescription>
            Existing certificate projects have not been checked. Retry before choosing a project.
            <Button
              variant="outline"
              isPending={certManagerQuery.isFetching}
              onClick={() => certManagerQuery.refetch()}
            >
              Retry Certificate Manager
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {statsQuery.isError && (
        <Alert variant="warning" className="mb-5">
          <AlertTitle>Product Counts Are Unavailable</AlertTitle>
          <AlertDescription>
            You can still open your products. Retry to refresh the counts.
            <Button
              variant="outline"
              isPending={statsQuery.isFetching}
              onClick={() => statsQuery.refetch()}
            >
              Retry Counts
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {PRODUCT_TYPES.map((type) => {
          const stats = getStatsForType(type);
          const { iconClassName, containerClassName, cardClassName, titleUnderlineClassName } =
            PRODUCT_STYLES[type];
          const Icon = getProjectLucideIcon(type);

          const tileBody = (
            <>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div
                    className={`shrink-0 rounded-sm border p-1.5 transition-colors duration-200 ${containerClassName}`}
                  >
                    <Icon className={iconClassName} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardDescription className="text-base font-semibold text-foreground">
                      <span
                        className={`underline decoration-[1.5px] underline-offset-4 ${titleUnderlineClassName}`}
                      >
                        {getProjectTitle(type)}
                      </span>
                    </CardDescription>
                    <p
                      id={`product-description-${type}`}
                      className="mt-1 text-sm leading-relaxed text-muted"
                    >
                      {getProjectDescription(type)}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {stats.length > 0 && (
                  <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
                    {stats.map((stat, index) => (
                      <div key={stat.label} className="flex items-center gap-4">
                        <span className="text-muted">
                          <span className="text-sm font-medium text-foreground">
                            {formatNumber(stat.value)}
                          </span>{" "}
                          <span className="text-xs">{stat.label}</span>
                        </span>
                        {index < stats.length - 1 && <div className="h-4 w-px bg-border" />}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </>
          );

          const isAccessBlocked =
            (type === ProjectType.CertificateManager && isCertManagerAccessBlocked) ||
            (type === ProjectType.PAM && isPamAccessBlocked);

          const isUnavailable =
            isAccessBlocked ||
            (type === ProjectType.CertificateManager &&
              (certManagerQuery.isPending || certManagerQuery.isError));
          let accessMessage = "Checking available certificate projects.";
          if (isAccessBlocked) {
            accessMessage = "You do not have access. Ask an organization admin for access.";
          } else if (certManagerQuery.isError) {
            accessMessage = "Project lookup failed. Use Retry Certificate Manager above.";
          }

          return (
            <Card
              key={type}
              className={`group relative h-auto min-w-0 rounded-md ${isUnavailable ? "" : cardClassName}`}
            >
              {tileBody}
              <button
                type="button"
                aria-label={getProjectTitle(type)}
                aria-describedby={`product-description-${type}${isUnavailable ? ` product-access-${type}` : ""}`}
                aria-disabled={isUnavailable}
                onClick={() => {
                  if (!isUnavailable) handleTileClick(type);
                }}
                className={`absolute inset-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring ${isUnavailable ? "cursor-not-allowed" : "cursor-pointer"}`}
              />
              {isUnavailable && (
                <p id={`product-access-${type}`} className="text-sm text-muted">
                  {accessMessage}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <RequestProjectAccessModal
        isOpen={isRequestAccessOpen}
        onOpenChange={setIsRequestAccessOpen}
        project={requestAccessProject}
        subTitle="Requesting access to Certificate Manager. You may include an optional note for admins to review your request."
      />

      <RequestProjectAccessModal
        isOpen={isPamRequestAccessOpen}
        onOpenChange={(isOpen) => {
          setIsPamRequestAccessOpen(isOpen);
          if (!isOpen) setPendingPamProjectId(null);
        }}
        project={pamRequestAccessProject}
        subTitle="Requesting access to Privileged Access Manager. You may include an optional note for admins to review your request."
      />

      <CertManagerNotConfiguredModal
        isOpen={isCertManagerSetupOpen}
        onOpenChange={setIsCertManagerSetupOpen}
      />

      <CertManagerSelectInstanceModal
        isOpen={isCertManagerPickerOpen}
        onOpenChange={setIsCertManagerPickerOpen}
        instances={cmInstances}
        orgDefaultProjectId={orgDefaultCertManagerProjectId}
        onSelect={handleCertManagerInstanceSelect}
      />
    </>
  );
};
