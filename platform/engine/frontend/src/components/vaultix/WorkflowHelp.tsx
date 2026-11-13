import { useRef, useState } from "react";
import { CircleHelpIcon } from "lucide-react";

import { Button } from "@app/components/v3/generic/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@app/components/v3/generic/Dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@app/components/v3/generic/Tooltip";

import { vaultixActionTrigger } from "./action-trigger";

export type WorkflowHelpStep = { title: string; description: string };

type WorkflowHelpProps = {
  title: string;
  description: string;
  steps: readonly WorkflowHelpStep[];
  actionId: string;
  scope: string;
  target: string;
  availability?: string;
};

export const WorkflowHelp = ({
  title,
  description,
  steps,
  actionId,
  scope,
  target,
  availability
}: WorkflowHelpProps) => {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip disableHoverableContent={false} delayDuration={300}>
        <TooltipTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            aria-label={`Show Me How: ${title}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            {...vaultixActionTrigger(actionId, { scope, target })}
          >
            <CircleHelpIcon aria-hidden="true" />
            Show Me How
          </Button>
        </TooltipTrigger>
        <TooltipContent className="pointer-events-auto max-w-64 motion-reduce:animate-none">
          See the steps before opening {title}. Your workspace stays here.
        </TooltipContent>
      </Tooltip>
      <DialogContent
        className="motion-reduce:animate-none"
        overlayClassName="motion-reduce:animate-none"
        onKeyDown={(event) => {
          // Focus can arrive before the document-level dismissable layer settles.
          // Honor Escape from this guide without dismissing a nested surface.
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !event.nativeEvent.isComposing &&
            (event.target as HTMLElement).closest('[role="dialog"]') === event.currentTarget
          ) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="leading-snug">{title}: Getting Started</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-4" aria-label="Workflow steps">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-container text-xs font-semibold text-foreground"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="rounded-sm border border-border bg-container p-3 text-sm text-muted">
          {availability ??
            "This guide explains the workflow. It does not change your projects or permissions."}
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Back to My Workspace</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
