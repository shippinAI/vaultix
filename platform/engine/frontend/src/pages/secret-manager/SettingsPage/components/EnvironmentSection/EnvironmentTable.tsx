import { useLayoutEffect, useRef, useState } from "react";
import { format, intervalToDuration } from "date-fns";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Ellipsis,
  HourglassIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon
} from "lucide-react";

import { createNotification } from "@app/components/notifications";
import { ProjectPermissionCan } from "@app/components/permissions";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3";
import { ProjectPermissionActions, ProjectPermissionSub, useProject } from "@app/context";
import { useRestoreEnvironment, useUpdateWsEnvironment } from "@app/hooks/api";
import { ProjectDeletedEnvActor } from "@app/hooks/api/projects/types";
import { UsePopUpState } from "@app/hooks/usePopUp";

type PopUpKeys = "updateEnv" | "deleteEnv" | "hardDeleteEnv";

type EnvPayload = { name: string; slug: string; id: string; deleteAfter?: string };

type Props = {
  handlePopUpOpen: (popUpName: keyof UsePopUpState<[PopUpKeys]>, env: EnvPayload) => void;
};

const getActorLabel = (actor: ProjectDeletedEnvActor | null): string => {
  if (!actor) return "Someone";
  if (actor.type === "identity") return actor.name || "An identity";

  return actor.firstName || actor.username || actor.email || "A user";
};

const formatRemainingDuration = (target: Date): string | null => {
  const now = new Date();
  if (target.getTime() <= now.getTime()) return null;

  const duration = intervalToDuration({ start: now, end: target });
  const parts: Array<[number | undefined, string]> = [
    [duration.years, "y"],
    [duration.months, "mo"],
    [duration.days, "d"],
    [duration.hours, "h"],
    [duration.minutes, "m"]
  ];

  const nonZero = parts.filter(([value]) => value && value > 0).slice(0, 2);
  if (nonZero.length === 0) return "<1m";

  return nonZero.map(([value, suffix]) => `${value}${suffix}`).join(" ");
};

export const EnvironmentTable = ({ handlePopUpOpen }: Props) => {
  const { currentProject } = useProject();
  const running = useRef(false);
  const reorderFocus = useRef<{ id: string; position: number; control: HTMLElement }>();
  const restoringId = useRef<string>();
  const [operationFailed, setOperationFailed] = useState(false);

  const updateEnvironment = useUpdateWsEnvironment();
  const restoreEnvironment = useRestoreEnvironment();
  const isPending = updateEnvironment.isPending || restoreEnvironment.isPending;

  const activeEnvironments = currentProject.environments ?? [];
  const deletedEnvironments = currentProject.deletedEnvironments ?? [];

  useLayoutEffect(() => {
    const pending = reorderFocus.current;
    if (!pending || isPending) return;
    const position = activeEnvironments.findIndex(({ id }) => id === pending.id) + 1;
    if (!operationFailed && position !== pending.position) return;
    reorderFocus.current = undefined;
    // Query invalidation can finish after the mutation; wait for the reordered row.
    // Respect a user who has already moved to another control while waiting.
    if (document.activeElement !== document.body && document.activeElement !== pending.control)
      return;
    const control = document.getElementById(pending.control.id) as HTMLButtonElement | null;
    if (control && !control.disabled) control.focus();
    else document.getElementById(`environment-options-${pending.id}`)?.focus();
  }, [activeEnvironments, isPending, operationFailed]);

  useLayoutEffect(() => {
    const id = restoringId.current;
    if (!id || isPending) return;
    if (!operationFailed && !activeEnvironments.some((environment) => environment.id === id))
      return;
    restoringId.current = undefined;
    const target = document.getElementById(`environment-options-${id}`);
    if (document.activeElement === document.body || document.activeElement === target)
      target?.focus();
  }, [activeEnvironments, isPending, operationFailed]);

  const runOperation = async (operation: () => Promise<unknown>, message: string) => {
    if (running.current) return;
    running.current = true;
    setOperationFailed(false);
    try {
      await operation();
      createNotification({ text: message, type: "success" });
    } catch {
      // The shared mutation cache reports the server error once.
      setOperationFailed(true);
    } finally {
      running.current = false;
    }
  };

  const handleReorderEnv = (id: string, position: number, control: HTMLElement) => {
    if (running.current) return;
    reorderFocus.current = { id, position, control };
    runOperation(
      () => updateEnvironment.mutateAsync({ projectId: currentProject.id, id, position }),
      "Environments reordered"
    );
  };
  const handleRestoreEnv = (id: string) => {
    if (running.current) return;
    restoringId.current = id;
    runOperation(
      () => restoreEnvironment.mutateAsync({ projectId: currentProject.id, id }),
      "Environment restored"
    );
  };

  if (!activeEnvironments.length && !deletedEnvironments.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No environments found</EmptyTitle>
          <EmptyDescription>
            Create your first environment to organize secrets by stage.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      {operationFailed && (
        <p role="alert" className="mb-3 text-sm text-muted">
          The environment operation failed. Check the error notice and retry.
        </p>
      )}
      <Table aria-label="Project environments" aria-busy={isPending}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeEnvironments.map(({ name, slug, id }, pos) => (
            <TableRow key={id}>
              <TableCell>{name}</TableCell>
              <TableCell>{slug}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <ProjectPermissionCan
                    I={ProjectPermissionActions.Edit}
                    a={ProjectPermissionSub.Environments}
                  >
                    {(isAllowed) => (
                      <IconButton
                        id={`environment-down-${id}`}
                        aria-label={`Move ${name} down`}
                        variant="ghost-muted"
                        onClick={(event) =>
                          handleReorderEnv(
                            id,
                            Math.min(activeEnvironments.length, pos + 2),
                            event.currentTarget
                          )
                        }
                        isDisabled={
                          isPending || pos === activeEnvironments.length - 1 || !isAllowed
                        }
                      >
                        <ArrowDownIcon />
                      </IconButton>
                    )}
                  </ProjectPermissionCan>
                  <ProjectPermissionCan
                    I={ProjectPermissionActions.Edit}
                    a={ProjectPermissionSub.Environments}
                  >
                    {(isAllowed) => (
                      <IconButton
                        id={`environment-up-${id}`}
                        aria-label={`Move ${name} up`}
                        variant="ghost-muted"
                        onClick={(event) =>
                          handleReorderEnv(id, Math.max(1, pos), event.currentTarget)
                        }
                        isDisabled={isPending || pos === 0 || !isAllowed}
                      >
                        <ArrowUpIcon />
                      </IconButton>
                    )}
                  </ProjectPermissionCan>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        id={`environment-options-${id}`}
                        aria-label={`Options for ${name}`}
                        variant="ghost-muted"
                        isDisabled={isPending}
                      >
                        <Ellipsis />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="data-[state=closed]:animate-none!">
                      <ProjectPermissionCan
                        I={ProjectPermissionActions.Edit}
                        a={ProjectPermissionSub.Environments}
                      >
                        {(isAllowed) => (
                          <DropdownMenuItem
                            isDisabled={!isAllowed || isPending}
                            onClick={() => handlePopUpOpen("updateEnv", { name, slug, id })}
                          >
                            <PencilIcon />
                            Edit environment
                          </DropdownMenuItem>
                        )}
                      </ProjectPermissionCan>
                      <ProjectPermissionCan
                        I={ProjectPermissionActions.Delete}
                        a={ProjectPermissionSub.Environments}
                      >
                        {(isAllowed) => (
                          <DropdownMenuItem
                            variant="danger"
                            isDisabled={!isAllowed || isPending}
                            onClick={() => handlePopUpOpen("deleteEnv", { name, slug, id })}
                          >
                            <Trash2Icon />
                            Delete environment
                          </DropdownMenuItem>
                        )}
                      </ProjectPermissionCan>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {deletedEnvironments.map(({ name, slug, id, deleteAfter, softDeletedAt, deletedBy }) => {
            const deleteAfterDate = new Date(deleteAfter);
            const remaining = formatRemainingDuration(deleteAfterDate);

            return (
              <TableRow key={id} className="bg-warning/[0.025]">
                <TableCell className="whitespace-normal text-muted">
                  <span className="line-through">{name}</span>
                  <p className="mt-1 text-xs">
                    Deleted by {getActorLabel(deletedBy)} ·{" "}
                    {format(new Date(softDeletedAt), "MMM d, yyyy")}
                  </p>
                  <p className="mt-1 text-xs">
                    {remaining ? `Permanent deletion in ${remaining}: ` : "Awaiting cleanup: "}
                    <time dateTime={deleteAfter}>
                      {format(deleteAfterDate, "MMM d, yyyy, h:mm a")}
                    </time>
                  </p>
                </TableCell>
                <TableCell className="text-muted">{slug}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Badge variant="warning">
                      <HourglassIcon />
                      Pending deletion
                    </Badge>
                    <ProjectPermissionCan
                      I={ProjectPermissionActions.Delete}
                      a={ProjectPermissionSub.Environments}
                    >
                      {(isAllowed) => (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild disabled={!isAllowed}>
                            <IconButton
                              id={`environment-options-${id}`}
                              aria-label={`Options for ${name}`}
                              variant="ghost-muted"
                              isDisabled={!isAllowed || isPending}
                            >
                              <Ellipsis />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="data-[state=closed]:animate-none!"
                          >
                            <DropdownMenuItem
                              isDisabled={isPending}
                              onClick={() => handleRestoreEnv(id)}
                            >
                              <RotateCcwIcon />
                              Restore environment
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="danger"
                              isDisabled={isPending}
                              onClick={() =>
                                handlePopUpOpen("hardDeleteEnv", { name, slug, id, deleteAfter })
                              }
                            >
                              <Trash2Icon />
                              Delete permanently
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </ProjectPermissionCan>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
};
