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
import { useUpdateWsEnvironment } from "@app/hooks/api";
import { UsePopUpState } from "@app/hooks/usePopUp";

import { restoreEnvironmentTriggerFocus } from "./environment-focus";
import { EnvironmentForm, EnvironmentFormValues } from "./EnvironmentForm";

type Props = {
  popUp: UsePopUpState<["updateEnv"]>;
  handlePopUpClose: (popUpName: keyof UsePopUpState<["updateEnv"]>) => void;
  handlePopUpToggle: (popUpName: keyof UsePopUpState<["updateEnv"]>, state?: boolean) => void;
};

export const UpdateEnvironmentModal = ({ popUp, handlePopUpClose, handlePopUpToggle }: Props) => {
  const { currentProject } = useProject();
  const focusId = useRef<string>();
  const submitting = useRef(false);
  const { mutateAsync, isPending } = useUpdateWsEnvironment();
  const environment = popUp.updateEnv.data as (EnvironmentFormValues & { id: string }) | undefined;

  const onSubmit = async (values: EnvironmentFormValues) => {
    if (!environment?.id) throw new Error("Select an environment before updating it.");
    submitting.current = true;
    try {
      await mutateAsync({ projectId: currentProject.id, id: environment.id, ...values });
      createNotification({ text: "Environment updated", type: "success" });
      handlePopUpClose("updateEnv");
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Dialog
      open={popUp.updateEnv.isOpen}
      onOpenChange={(open) => {
        if (!isPending && !submitting.current) handlePopUpToggle("updateEnv", open);
      }}
    >
      <DialogContent
        className="[overflow-wrap:anywhere] sm:max-w-md"
        showCloseButton={!isPending}
        onOpenAutoFocus={() => {
          focusId.current = environment?.id;
        }}
        onCloseAutoFocus={(event) => {
          const target = document.getElementById(`environment-options-${focusId.current}`);
          restoreEnvironmentTriggerFocus(event, target);
        }}
      >
        <DialogHeader>
          <DialogTitle>Update Environment</DialogTitle>
          <DialogDescription className="text-muted">
            Update the environment name or reference identifier.
          </DialogDescription>
        </DialogHeader>
        {environment && (
          <EnvironmentForm
            key={environment.id}
            mode="update"
            initialValues={environment}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
