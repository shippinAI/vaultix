import { type ComponentPropsWithoutRef, useEffect, useRef, useState } from "react";
import {
  BotIcon,
  CheckIcon,
  HandIcon,
  MousePointer2Icon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon
} from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";
import { useVaultixGuidance } from "@app/hooks/api/vaultix/guidance";

import { referenceCommandCatalog, type ReferenceControls } from "./reference-commands";
import { ReferenceWorkspace } from "./ReferenceWorkspace";

import "./reference-teaching.css";

export const ReferenceTeaching = ({
  demo = false,
  ...props
}: ComponentPropsWithoutRef<typeof ReferenceWorkspace> & { demo?: boolean }) => {
  const controls = useRef<ReferenceControls>(null);
  const surface = useRef<HTMLDivElement>(null);
  const guidance = useVaultixGuidance();
  const guide = guidance.data?.find((entry) => entry.id === "references");
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [notice, setNotice] = useState("Watch the steps, then make them your own.");
  const [events, setEvents] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const [reducedMotion, setReducedMotion] = useState(false);
  const generation = useRef(0);
  const stop = (message: string) => {
    generation.current += 1;
    setPlaying(false);
    setNotice(message);
  };
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    const hidden = () => {
      if (document.hidden) stop("Paused while this tab is away. Resume when you are ready.");
    };
    update();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      generation.current += 1;
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const advance = () => {
    const snapshot = controls.current?.snapshot();
    if (!snapshot?.ready || snapshot.failed) {
      stop("The workspace is not ready. Check access or retry the workspace, then start again.");
      return;
    }
    if (snapshot.loading) return;
    if (step === 3) {
      if (snapshot.completed) {
        setCompleted(true);
        stop(
          demo
            ? "Rehearsal complete. Try the same controls yourself."
            : "References loaded. You are in control."
        );
      }
      return;
    }
    const next = step + 1;
    const definition = referenceCommandCatalog[next];
    let value: string | undefined = "/";
    if (next === 0) value = snapshot.firstProject?.id;
    if (next === 1) value = snapshot.firstProject?.environment;
    const accepted = controls.current?.execute({
      version: 1,
      scope: props.scopeKey,
      action: definition.id,
      ...(next < 3 ? { value } : {})
    });
    if (!accepted) {
      stop("This action is unavailable. Take over or restart after checking the selections.");
      return;
    }
    setStep(next);
    setEvents((current) => [...current.slice(-7), definition.id]);
    setNotice(guide?.steps[next]?.hint ?? "Follow the highlighted control.");
  };
  useEffect(() => {
    if (!playing) return undefined;
    const { current } = generation;
    const timer = window.setInterval(
      () => {
        if (current === generation.current && !document.hidden) advance();
      },
      step === -1 ? 500 : 2600
    );
    return () => window.clearInterval(timer);
  });
  useEffect(() => {
    const update = () => {
      const target = referenceCommandCatalog[step]?.target;
      const element = target ? surface.current?.querySelector<HTMLElement>(`#${target}`) : null;
      if (!element || !surface.current) {
        setPointer(undefined);
        return;
      }
      const box = element.getBoundingClientRect();
      const origin = surface.current.getBoundingClientRect();
      setPointer({
        x: box.left - origin.left + box.width * 0.7,
        y: box.top - origin.top + box.height * 0.7
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (surface.current) observer.observe(surface.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [step]);
  const start = () => {
    if (!guide) return;
    generation.current += 1;
    if (
      !controls.current?.execute({ version: 1, scope: props.scopeKey, action: "reference.reset" })
    ) {
      stop("Wait for the current request to finish before restarting.");
      return;
    }
    setStep(-1);
    setEvents([]);
    setCompleted(false);
    setNotice("Starting the guided workflow. Touch any workspace control to take over.");
    setPlaying(true);
  };
  let PlayControl = PlayIcon;
  let playLabel = "Show me";
  if (step >= 0) {
    PlayControl = RotateCcwIcon;
    playLabel = "Replay walkthrough";
  }
  if (playing) {
    PlayControl = PauseIcon;
    playLabel = "Pause";
  }
  return (
    <section
      aria-label={demo ? "Interactive Vaultix rehearsal" : "Guided reference workspace"}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-project/40 bg-project/5 p-4">
        <div className="flex items-center gap-3">
          <BotIcon className="size-6 text-project" aria-hidden="true" />
          <div>
            <p className="font-medium">{demo ? "Clyffy rehearsal" : "Show me the workflow"}</p>
            <p className="text-xs text-muted">
              {demo
                ? "Sample workspace · scripted actions · no AI connection"
                : "Guided actions · your permissions · names only"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="project"
            disabled={!guide}
            onClick={playing ? () => stop("Paused. Your selections are kept.") : start}
          >
            <PlayControl />
            {playLabel}
          </Button>
          {step >= 0 && (
            <Button
              variant="outline"
              onClick={() => stop("You are in control. Use the highlighted fields to continue.")}
            >
              <HandIcon />
              Take over
            </Button>
          )}
          {!playing && step >= 0 && !completed && (
            <Button
              variant="outline"
              onClick={() => {
                generation.current += 1;
                setPlaying(true);
                setNotice("Continuing the guided workflow.");
              }}
            >
              <PlayIcon /> Resume
            </Button>
          )}
        </div>
      </div>
      {guidance.isError && (
        <p role="status" className="text-sm text-muted">
          Teaching content is unavailable. The workspace still works.{" "}
          <Button
            variant="ghost"
            onClick={() => {
              guidance.refetch().catch(() => {});
            }}
          >
            Retry teaching
          </Button>
        </p>
      )}
      <div
        ref={surface}
        data-vaultix-teaching-step={step}
        className="vaultix-teaching-surface relative"
        onPointerDownCapture={() => {
          if (playing) stop("You took over. Your selections are kept.");
        }}
        onKeyDownCapture={() => {
          if (playing) stop("You took over. Your selections are kept.");
        }}
      >
        <ReferenceWorkspace
          {...props}
          ref={controls}
          onUserInteraction={() => {
            if (playing) stop("You took over. Your selections are kept.");
          }}
        />
        {pointer && playing && !reducedMotion && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 text-project transition-[left,top] duration-500 motion-reduce:transition-none"
            style={{ left: pointer.x, top: pointer.y }}
          >
            <MousePointer2Icon className="size-6 fill-project stroke-background" />
            <span className="ml-4 rounded border border-project/40 bg-background px-2 py-1 text-xs">
              Clyffy · scripted
            </span>
          </div>
        )}
      </div>
      <div
        className="flex gap-3 rounded-md border border-border bg-container p-4"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {completed ? (
          <CheckIcon className="size-5 shrink-0 text-project" />
        ) : (
          <BotIcon className="size-5 shrink-0 text-project" />
        )}
        <div>
          <p className="text-sm font-medium">
            {step >= 0 ? guide?.steps[step]?.title : "A little help, right where you need it."}
          </p>
          <p className="mt-1 text-sm text-muted">{notice}</p>
        </div>
      </div>
      {events.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer py-2">See the scripted actions</summary>
          <ol className="mt-2 space-y-2">
            {events.map((event) => (
              <li key={event}>
                <code>{event}</code>
              </li>
            ))}
          </ol>
          <p className="mt-3">
            These actions use the same workspace handlers as your clicks. A connected AI session is
            separate.
          </p>
        </details>
      )}
    </section>
  );
};
