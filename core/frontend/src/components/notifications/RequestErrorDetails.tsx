import { ReactNode, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@app/components/v3/generic/Dialog";

type ErrorDetails = {
  title: string;
  description: string;
  content: ReactNode;
  toastId: string | number;
  returnFocus: HTMLElement | null;
};

// Store display-ready details only. Never retain an Axios error or request body.
let queue: ErrorDetails[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => queue;
const notify = () => listeners.forEach((listener) => listener());

export const showRequestErrorDetails = (details: ErrorDetails) => {
  if (queue.some((item) => item.toastId === details.toastId)) return;
  queue = [...queue, details];
  notify();
};

export function RequestErrorDetails() {
  const [details] = useSyncExternalStore(subscribe, snapshot);
  if (!details) return null;

  return (
    <Dialog
      key={details.toastId}
      open
      onOpenChange={(open) => {
        if (open) return;
        queue = queue.filter((item) => item !== details);
        toast.dismiss(details.toastId);
        notify();
      }}
    >
      <DialogContent
        className="z-[100] sm:max-w-2xl"
        overlayClassName="z-[100]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!queue.length && details.returnFocus?.isConnected) details.returnFocus.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{details.title}</DialogTitle>
          <DialogDescription>{details.description}</DialogDescription>
        </DialogHeader>
        <DialogBody>{details.content}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
