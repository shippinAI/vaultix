import { useEffect, useId, useRef, useState } from "react";

import { createNotification } from "@app/components/notifications";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldLabel,
  Input
} from "@app/components/v3";
import { useOrganization, useProject } from "@app/context";
import { getProjectHomePage } from "@app/helpers/project";
import { useAssumeProjectPrivileges } from "@app/hooks/api";
import { ActorType } from "@app/hooks/api/auditLogs/enums";

const CONFIRM_KEY = "assume";

type Props = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  actorType: ActorType;
  actorId?: string;
};

export const AssumePrivilegesModal = ({ isOpen, onOpenChange, actorType, actorId }: Props) => {
  const { currentOrg } = useOrganization();
  const { currentProject } = useProject();
  const assumePrivileges = useAssumeProjectPrivileges();
  const [inputData, setInputData] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);
  const inFlight = useRef(false);
  const inputId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const { reset } = assumePrivileges;

  useEffect(() => {
    if (!inFlight.current) {
      setInputData("");
      reset();
    }
  }, [isOpen, actorId, reset]);

  const isUser = actorType === ActorType.USER;
  const noun = isUser ? "user" : "machine identity";
  const isConfirmed = inputData === CONFIRM_KEY;
  const isBusy = assumePrivileges.isPending || isNavigating;
  const hasContext = Boolean(
    actorId &&
      currentOrg?.id &&
      currentProject?.id &&
      (actorType === ActorType.USER || actorType === ActorType.IDENTITY)
  );
  const needsReconciliation = assumePrivileges.isError;
  const changeOpen = (open: boolean) => {
    if (inFlight.current) return;
    if (!open && needsReconciliation) {
      window.location.reload();
      return;
    }
    onOpenChange(open);
  };

  const handleConfirm = () => {
    if (
      inFlight.current ||
      isBusy ||
      needsReconciliation ||
      !isConfirmed ||
      !hasContext ||
      !actorId ||
      !currentOrg?.id ||
      !currentProject?.id
    )
      return;
    inFlight.current = true;

    assumePrivileges.mutate(
      {
        actorId,
        actorType,
        projectId: currentProject.id
      },
      {
        onError: () => {
          inFlight.current = false;
        },
        onSuccess: () => {
          setIsNavigating(true);
          createNotification({
            type: "success",
            text: `${isUser ? "User" : "Machine identity"} privilege assumption has started`
          });

          const url = getProjectHomePage(currentProject.type, currentProject.environments);
          window.location.assign(
            url.replace("$orgId", currentOrg.id).replace("$projectId", currentProject.id)
          );
        }
      }
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
      <DialogContent
        className="max-w-xl"
        showCloseButton={!isBusy}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return;
          // Menu items unmount on selection. Follow the menu's explicit ARIA
          // relationship to its persistent trigger before moving focus inside.
          const triggerId = active.closest('[role="menu"]')?.getAttribute("aria-labelledby");
          returnFocus.current = (triggerId && document.getElementById(triggerId)) || active;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Assume {isUser ? "User" : "Machine Identity"} Privileges</DialogTitle>
          <DialogDescription>
            Use this {noun}&apos;s permissions in this project for up to one hour. Actions still
            change real resources. Exit from the project banner to return to your own access.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirm();
          }}
        >
          <Field>
            <FieldLabel htmlFor={inputId}>
              Type <span className="font-bold">{CONFIRM_KEY}</span> to perform this action
            </FieldLabel>
            <FieldContent>
              <Input
                id={inputId}
                readOnly={isBusy || needsReconciliation}
                aria-describedby={`${inputId}-status`}
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
                placeholder={`Type ${CONFIRM_KEY} here`}
                autoComplete="off"
              />
            </FieldContent>
          </Field>
        </form>
        <p
          id={`${inputId}-status`}
          role="status"
          aria-label="Privilege status"
          className="text-sm text-muted"
        >
          {isBusy && "Switching privileges. Wait for the project to reload."}
          {needsReconciliation &&
            "Vaultix could not confirm the switch. Reload the project to check your active privileges before trying again."}
          {!hasContext &&
            !isBusy &&
            "Close this dialog and select a project member or machine identity again."}
        </p>
        <DialogFooter>
          {needsReconciliation ? (
            <Button variant="project" onClick={() => window.location.reload()}>
              Reload Project
            </Button>
          ) : (
            <Button variant="ghost" isDisabled={isBusy} onClick={() => changeOpen(false)}>
              Cancel
            </Button>
          )}
          <Button
            variant="project"
            onClick={handleConfirm}
            isPending={isBusy}
            isDisabled={!isConfirmed || !hasContext || isBusy || needsReconciliation}
          >
            Assume Privileges
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
