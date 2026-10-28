import { type RefObject, useId, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, BookOpenIcon, LocateIcon } from "lucide-react";

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3";
import { type GuideId, guideTargets, useVaultixGuidance } from "@app/hooks/api/vaultix/guidance";

import { type GuideEventType, initialGuideState, reduceGuide } from "./guidance-state";

const eventLabels: Record<GuideEventType, string> = {
  open: "Opened guide",
  next: "Moved to next step",
  previous: "Returned to previous step",
  dismiss: "Paused guide",
  focus: "Moved to the control",
  restart: "Restarted guide",
  finish: "Reviewed guide"
};

export const GuidedHelp = ({
  guideId,
  initialTarget,
  targetScope
}: {
  guideId: GuideId;
  initialTarget?: string;
  targetScope?: RefObject<HTMLElement>;
}) => {
  const query = useVaultixGuidance();
  const dialogId = useId();
  const guide = query.data?.find((entry) => entry.id === guideId);
  const [state, setState] = useState(() => ({
    ...initialGuideState,
    index: Math.max(0, (guideTargets[guideId] as readonly string[]).indexOf(initialTarget ?? ""))
  }));
  const [notice, setNotice] = useState("");
  const focusTarget = useRef<HTMLElement | null>(null);
  const step = guide?.steps[state.index];
  const contextStep = guide?.steps.find((entry) => entry.target === initialTarget);
  const send = (type: GuideEventType) => {
    if (!guide || !step) return;
    setNotice("");
    setState((current) => reduceGuide(guide, current, { type, stepId: step.id }));
  };
  if ((query.data && !guide) || (initialTarget && (!guide || !step))) return null;
  if (query.isError)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted" role="status">
        <span>Help is unavailable.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            query.refetch().catch(() => {});
          }}
        >
          Retry Help
        </Button>
      </div>
    );
  if (!guide || !step)
    return (
      <span className="text-sm text-muted" role="status">
        Loading help...
      </span>
    );
  const last = state.index === guide.steps.length - 1;
  const showControl = () => {
    const target = targetScope
      ? targetScope.current?.querySelector<HTMLElement>(
          `[data-vaultix-guide-target="${step.target}"]`
        )
      : document.getElementById(step.target);
    if (!target || target.matches(":disabled,[aria-disabled=true]")) {
      setNotice(
        "This control is not available yet. Close the guide and complete the earlier choices or sign in first."
      );
      return;
    }
    focusTarget.current = target;
    send("focus");
  };
  return (
    <Dialog open={state.open} onOpenChange={(open) => send(open ? "open" : "dismiss")}>
      <Tooltip disableHoverableContent={false}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild aria-controls={state.open ? dialogId : undefined}>
            <Button
              type="button"
              variant={initialTarget ? "ghost" : "outline"}
              size="sm"
              aria-label={contextStep ? `Help: ${contextStep.title}` : undefined}
            >
              <BookOpenIcon />
              {!initialTarget && (state.reviewed ? "Review Guide" : "Guide Me")}
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="pointer-events-auto max-w-xs motion-reduce:animate-none!">
          {contextStep?.hint ?? "Learn this workflow, one step at a time."}
        </TooltipContent>
      </Tooltip>
      <DialogContent
        id={dialogId}
        className="motion-reduce:animate-none!"
        overlayClassName="motion-reduce:animate-none!"
        onCloseAutoFocus={(event) => {
          if (!focusTarget.current) return;
          event.preventDefault();
          focusTarget.current.focus({ preventScroll: true });
          focusTarget.current.scrollIntoView({ block: "center", behavior: "instant" });
          focusTarget.current = null;
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{guide.title}</DialogTitle>
          <DialogDescription className="text-muted">{guide.summary}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5 pb-2">
          <ol aria-label="Lesson progress" className="flex gap-2">
            {guide.steps.map((entry, index) => (
              <li
                key={entry.id}
                aria-current={index === state.index ? "step" : undefined}
                className={`flex min-h-9 flex-1 items-center justify-center rounded border text-sm motion-safe:transition-colors motion-reduce:transition-none ${index === state.index ? "border-project bg-project/10 text-project" : "border-border text-muted"}`}
              >
                <span aria-hidden="true">{index + 1}</span>
                <span className="sr-only">
                  Step {index + 1}: {entry.title}
                </span>
              </li>
            ))}
          </ol>
          <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col gap-3">
            <p className="text-xs text-muted">
              Step {state.index + 1} of {guide.steps.length}
            </p>
            <h3 className="text-lg font-medium">{step.title}</h3>
            <p className="text-sm leading-relaxed">{step.body}</p>
            <p className="rounded-md border border-project/30 bg-project/5 p-3 text-sm leading-relaxed text-muted">
              {step.teaches}
            </p>
          </div>
          <Button variant="outline" className="self-start" onClick={showControl}>
            <LocateIcon />
            Show This Control
          </Button>
          {notice && (
            <p role="status" className="text-sm text-muted">
              {notice}
            </p>
          )}
          <details className="text-sm text-muted">
            <summary className="cursor-pointer rounded py-2 focus-visible:outline-2 focus-visible:outline-project">
              Guide Activity
            </summary>
            <ol className="mt-2 flex list-inside list-decimal flex-col gap-2">
              {state.history.map((entry) => (
                <li key={entry.sequence}>
                  {eventLabels[entry.type]}:{" "}
                  {guide.steps.find((item) => item.id === entry.stepId)?.title}
                </li>
              ))}
            </ol>
          </details>
          <p className="text-xs text-muted">
            This guide explains the workflow. It does not run actions or change your vault.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => send("dismiss")}>
            Pause Guide
          </Button>
          <Button variant="ghost" onClick={() => send("restart")}>
            Restart
          </Button>
          <Button variant="outline" disabled={state.index === 0} onClick={() => send("previous")}>
            <ArrowLeftIcon />
            Back
          </Button>
          <Button variant="project" onClick={() => send(last ? "finish" : "next")}>
            {last ? "Finish Guide" : "Next Step"}
            <ArrowRightIcon />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const GuidanceHint = ({
  guideId,
  target,
  targetScope
}: {
  guideId: GuideId;
  target: string;
  targetScope?: RefObject<HTMLElement>;
}) => <GuidedHelp guideId={guideId} initialTarget={target} targetScope={targetScope} />;
