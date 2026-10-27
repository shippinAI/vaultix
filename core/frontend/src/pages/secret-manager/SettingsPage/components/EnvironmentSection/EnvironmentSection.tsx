import { useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { ClockIcon, KeyIcon, PlusIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

import { createNotification } from "@app/components/notifications";
import { PermissionDeniedBanner, ProjectPermissionCan } from "@app/components/permissions";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldLabel,
  Input
} from "@app/components/v3";
import {
  ProjectPermissionActions,
  ProjectPermissionSub,
  useProject,
  useProjectPermission
} from "@app/context";
import { useDeleteWsEnvironment } from "@app/hooks/api";
import { usePopUp } from "@app/hooks/usePopUp";

import { AddEnvironmentModal } from "./AddEnvironmentModal";
import { restoreEnvironmentTriggerFocus } from "./environment-focus";
import { EnvironmentTable } from "./EnvironmentTable";
import { UpdateEnvironmentModal } from "./UpdateEnvironmentModal";

export const EnvironmentSection = () => {
  const { currentProject } = useProject();
  const { permission } = useProjectPermission();

  const deleteWsEnvironment = useDeleteWsEnvironment();
  const [hardDeleteConfirmation, setHardDeleteConfirmation] = useState("");
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleting = useRef(false);
  const focusId = useRef<string>();
  const restoreFocus = (event: Event) => {
    const target =
      document.getElementById(`environment-options-${focusId.current}`) ??
      document.getElementById("environment-create");
    restoreEnvironmentTriggerFocus(event, target);
  };

  const { popUp, handlePopUpOpen, handlePopUpClose, handlePopUpToggle } = usePopUp([
    "createEnv",
    "updateEnv",
    "deleteEnv",
    "hardDeleteEnv"
  ] as const);

  const deleteEnvData = popUp?.deleteEnv?.data as
    | { name: string; slug: string; id: string }
    | undefined;

  const hardDeleteEnvData = popUp?.hardDeleteEnv?.data as
    | { name: string; slug: string; id: string; deleteAfter?: string }
    | undefined;

  const onEnvDeleteSubmit = async () => {
    if (!currentProject?.id || !deleteEnvData?.id || deleting.current) return;
    deleting.current = true;
    setDeleteFailed(false);
    try {
      await deleteWsEnvironment.mutateAsync({ projectId: currentProject.id, id: deleteEnvData.id });
      createNotification({ text: "Environment scheduled for deletion", type: "success" });
      focusId.current = undefined;
      handlePopUpClose("deleteEnv");
    } catch {
      setDeleteFailed(true);
    } finally {
      deleting.current = false;
    }
  };

  const onSwitchToHardDelete = () => {
    if (!deleteEnvData || deleting.current) return;
    setDeleteFailed(false);
    setHardDeleteConfirmation("");
    handlePopUpClose("deleteEnv");
    handlePopUpOpen("hardDeleteEnv", deleteEnvData);
  };

  const onEnvHardDeleteSubmit = async () => {
    if (
      !currentProject?.id ||
      !hardDeleteEnvData?.id ||
      deleting.current ||
      hardDeleteConfirmation !== hardDeleteEnvData.slug
    )
      return;
    deleting.current = true;
    setDeleteFailed(false);
    try {
      await deleteWsEnvironment.mutateAsync({
        projectId: currentProject.id,
        id: hardDeleteEnvData.id,
        hardDelete: true
      });
      createNotification({ text: "Environment permanently deleted", type: "success" });
      focusId.current = undefined;
      handlePopUpClose("hardDeleteEnv");
      setHardDeleteConfirmation("");
    } catch {
      setDeleteFailed(true);
    } finally {
      deleting.current = false;
    }
  };

  return (
    <Card
      id="environments"
      role="region"
      aria-labelledby="environments-title"
      className="mb-6 scroll-m-6"
    >
      <CardHeader>
        <CardTitle>
          <h2 id="environments-title">Environments</h2>
        </CardTitle>
        <CardDescription className="text-muted">
          Choose which environments will show up in your dashboard like development, staging,
          production.
        </CardDescription>
        <CardAction>
          <ProjectPermissionCan
            I={ProjectPermissionActions.Create}
            a={ProjectPermissionSub.Environments}
          >
            {(isAllowed) => (
              <Button
                id="environment-create"
                variant="project"
                size="sm"
                onClick={() => handlePopUpOpen("createEnv")}
                isDisabled={!isAllowed}
              >
                <PlusIcon className="size-4" />
                Create Environment
              </Button>
            )}
          </ProjectPermissionCan>
        </CardAction>
      </CardHeader>
      <CardContent>
        {permission.can(ProjectPermissionActions.Read, ProjectPermissionSub.Environments) ? (
          <EnvironmentTable handlePopUpOpen={handlePopUpOpen} />
        ) : (
          <PermissionDeniedBanner />
        )}
      </CardContent>
      <AddEnvironmentModal
        isOpen={popUp.createEnv.isOpen}
        onOpenChange={(isOpen) => handlePopUpToggle("createEnv", isOpen)}
      />
      <UpdateEnvironmentModal
        popUp={popUp}
        handlePopUpClose={handlePopUpClose}
        handlePopUpToggle={handlePopUpToggle}
      />
      <AlertDialog
        open={popUp.deleteEnv.isOpen}
        onOpenChange={(isOpen) => {
          if (deleting.current) return;
          setDeleteFailed(false);
          handlePopUpToggle("deleteEnv", isOpen);
        }}
      >
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere] sm:max-w-xl!"
          aria-busy={deleteWsEnvironment.isPending}
          onOpenAutoFocus={() => {
            focusId.current = deleteEnvData?.id;
          }}
          onCloseAutoFocus={(event) => {
            if (popUp.hardDeleteEnv.isOpen) event.preventDefault();
            else restoreFocus(event);
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              Schedule deletion of {deleteEnvData?.name ?? "environment"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted">
              The {deleteEnvData?.slug ?? ""} environment will be inaccessible immediately, then
              permanently deleted on{" "}
              <span className="font-medium text-foreground">
                {format(addDays(new Date(), 14), "MMM d, yyyy")}
              </span>
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 rounded-md border border-border bg-foreground/5 p-3 text-sm">
            <div className="flex gap-2">
              <RotateCcwIcon className="mt-0.5 size-4 shrink-0 text-muted" />
              <p>
                <span className="font-medium text-foreground">Restore anytime within 14 days</span>{" "}
                <span>secrets, folders, and history are preserved.</span>
              </p>
            </div>
            <div className="flex gap-2">
              <KeyIcon className="mt-0.5 size-4 shrink-0 text-muted" />
              <p>
                Service tokens and integrations referencing {deleteEnvData?.slug ?? ""} will fail to
                resolve. Fix or remove them before the grace period ends.
              </p>
            </div>
            <div className="flex gap-2">
              <ClockIcon className="mt-0.5 size-4 shrink-0 text-muted" />
              <p>After 14 days, all secret data is wiped and cannot be recovered.</p>
            </div>
          </div>
          {deleteFailed && (
            <p role="alert" className="text-sm text-muted">
              Deletion failed. Check the error notice and retry.
            </p>
          )}
          <AlertDialogFooter className="sm:justify-between">
            <Button
              variant="danger"
              size="sm"
              onClick={onSwitchToHardDelete}
              isDisabled={deleteWsEnvironment.isPending}
            >
              Delete Permanently
            </Button>
            <div className="flex gap-2">
              <AlertDialogCancel isDisabled={deleteWsEnvironment.isPending}>
                Cancel
              </AlertDialogCancel>
              <Button
                variant="danger"
                onClick={onEnvDeleteSubmit}
                isPending={deleteWsEnvironment.isPending}
                isDisabled={deleteWsEnvironment.isPending}
              >
                Schedule Deletion
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={popUp.hardDeleteEnv.isOpen}
        onOpenChange={(isOpen) => {
          if (deleting.current) return;
          setDeleteFailed(false);
          handlePopUpToggle("hardDeleteEnv", isOpen);
          if (!isOpen) setHardDeleteConfirmation("");
        }}
      >
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere] sm:max-w-xl!"
          aria-busy={deleteWsEnvironment.isPending}
          onOpenAutoFocus={() => {
            focusId.current = hardDeleteEnvData?.id;
          }}
          onCloseAutoFocus={restoreFocus}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {hardDeleteEnvData?.name ?? "environment"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted">
              Bypass the grace period and wipe {hardDeleteEnvData?.slug ?? ""} immediately. All
              secrets, folders, and history will be lost. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="danger">
            <TriangleAlertIcon />
            <AlertDescription className="text-foreground!">
              <p>
                <span className="font-medium text-foreground">All secrets and folders</span> will be
                wiped from storage.
              </p>
              <p>
                Any service token or integration referencing {hardDeleteEnvData?.slug ?? ""} will
                fail immediately and cannot be restored from this UI.
              </p>
            </AlertDescription>
          </Alert>
          <div className="w-full pt-2 pb-4">
            <FieldLabel htmlFor="environment-delete-confirmation" className="mb-2">
              Type {hardDeleteEnvData?.slug ?? ""} to confirm.
            </FieldLabel>
            <Input
              id="environment-delete-confirmation"
              autoCapitalize="none"
              spellCheck={false}
              readOnly={deleteWsEnvironment.isPending}
              value={hardDeleteConfirmation}
              onChange={(e) => setHardDeleteConfirmation(e.target.value)}
              placeholder={hardDeleteEnvData?.slug ?? ""}
            />
          </div>
          {deleteFailed && (
            <p role="alert" className="text-sm text-muted">
              Deletion failed. Your confirmation is kept. Check the error notice and retry.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel isDisabled={deleteWsEnvironment.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="danger"
              size="sm"
              onClick={onEnvHardDeleteSubmit}
              isPending={deleteWsEnvironment.isPending}
              isDisabled={
                deleteWsEnvironment.isPending ||
                !hardDeleteEnvData?.slug ||
                hardDeleteConfirmation !== hardDeleteEnvData.slug
              }
            >
              Delete Permanently
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
