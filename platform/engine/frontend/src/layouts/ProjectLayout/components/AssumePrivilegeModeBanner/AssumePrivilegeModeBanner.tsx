import { useRef, useState } from "react";
import { Info } from "lucide-react";

import { Button } from "@app/components/v3";
import { useOrganization, useProject, useProjectPermission } from "@app/context";
import { getProjectHomePage } from "@app/helpers/project";
import { useRemoveAssumeProjectPrivilege } from "@app/hooks/api";
import { ActorType } from "@app/hooks/api/auditLogs/enums";

export const AssumePrivilegeModeBanner = () => {
  const { currentOrg } = useOrganization();
  const { currentProject } = useProject();
  const exitAssumePrivilegeMode = useRemoveAssumeProjectPrivilege();
  const { assumedPrivilegeDetails } = useProjectPermission();
  const inFlight = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);

  if (!assumedPrivilegeDetails) return null;

  const isBusy = exitAssumePrivilegeMode.isPending || isNavigating;
  const handleExit = () => {
    if (inFlight.current || isBusy || exitAssumePrivilegeMode.isError) return;
    inFlight.current = true;
    exitAssumePrivilegeMode.mutate(
      { projectId: currentProject.id },
      {
        onError: () => {
          inFlight.current = false;
        },
        onSuccess: () => {
          setIsNavigating(true);
          const url = getProjectHomePage(currentProject.type, currentProject.environments);
          // Reload all authority-dependent state after the server clears the grant.
          window.location.assign(
            url.replace("$orgId", currentOrg.id).replace("$projectId", currentProject.id)
          );
        }
      }
    );
  };

  return (
    <section
      aria-label="Assumed privileges"
      className="flex w-full flex-wrap items-center gap-3 border-b border-info/20 bg-info/5 px-4 py-3 text-sm text-foreground"
    >
      <Info aria-hidden="true" className="size-4 shrink-0 text-info" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="wrap-anywhere">
          Using privileges of{" "}
          {assumedPrivilegeDetails.actorType === ActorType.IDENTITY ? "identity" : "user"}{" "}
          <strong>{assumedPrivilegeDetails.actorName || assumedPrivilegeDetails.actorEmail}</strong>
          .
        </p>
        <p className="mt-1 text-muted">Actions affect real resources in this project.</p>
        <p role="status" aria-label="Privilege status" className="mt-1 text-muted">
          {isBusy && "Exiting assumed privileges. Wait for the project to reload."}
          {exitAssumePrivilegeMode.isError &&
            "Vaultix could not confirm the exit. Reload to check your active privileges before trying again."}
        </p>
      </div>
      {exitAssumePrivilegeMode.isError ? (
        <Button className="min-h-11" variant="outline" onClick={() => window.location.reload()}>
          Reload Project
        </Button>
      ) : (
        <Button className="min-h-11" variant="outline" isPending={isBusy} onClick={handleExit}>
          Exit Assumed Privileges
        </Button>
      )}
    </section>
  );
};
