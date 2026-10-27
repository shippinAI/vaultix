import { useRef } from "react";

import { createNotification } from "@app/components/notifications";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@app/components/v3";
import { useProject } from "@app/context";
import { useCreateWsEnvironment } from "@app/hooks/api";
import { ProjectEnv } from "@app/hooks/api/projects/types";

import { restoreEnvironmentTriggerFocus } from "./environment-focus";
import { EnvironmentForm, EnvironmentFormValues } from "./EnvironmentForm";

type Props = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onComplete?: (environment: ProjectEnv) => void;
};

export const AddEnvironmentModal = ({ isOpen, onOpenChange, onComplete }: Props) => {
  const { currentProject } = useProject();
  const returnFocus = useRef<HTMLElement | null>(null);
  const submitting = useRef(false);
  const { mutateAsync, isPending } = useCreateWsEnvironment();

  const onSubmit = async (values: EnvironmentFormValues) => {
    submitting.current = true;
    try {
      const environment = await mutateAsync({ projectId: currentProject.id, ...values });
      createNotification({ text: "Environment created", type: "success" });
      onComplete?.(environment);
      onOpenChange(false);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!isPending && !submitting.current) onOpenChange(open);
      }}
    >
      <DialogContent
        className="[overflow-wrap:anywhere] sm:max-w-md"
        showCloseButton={!isPending}
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          restoreEnvironmentTriggerFocus(event, returnFocus.current);
        }}
      >
        <DialogHeader>
          <DialogTitle>Create a new environment</DialogTitle>
          <DialogDescription className="text-muted">
            Separate secrets for a stage such as development, staging or production.
          </DialogDescription>
        </DialogHeader>
        <EnvironmentForm mode="create" onSubmit={onSubmit} />
      </DialogContent>
    </Dialog>
  );
};
