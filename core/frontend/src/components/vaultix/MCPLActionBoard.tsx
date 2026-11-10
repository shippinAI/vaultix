import { useMemo, useState } from "react";
import {
  ArrowRight,
  Cpu,
  FolderKey,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Waypoints
} from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";

import { vaultixActionTrigger } from "./action-trigger";
import { MCPL_ACTIONS, type McplAction, type McplDomain, type McplStatus } from "./mcpl-manifest";

const domainStyles: Record<McplDomain | "all", string> = {
  all: "border-border bg-container text-foreground",
  public: "border-project/25 bg-project/10 text-project",
  auth: "border-info/25 bg-info/10 text-info",
  identity: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  workspace: "border-org/25 bg-org/10 text-org",
  secrets: "border-success/25 bg-success/10 text-success",
  policy: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  connect: "border-warning/25 bg-warning/10 text-warning",
  ai: "border-sub-org/25 bg-sub-org/10 text-sub-org",
  operate: "border-danger/25 bg-danger/10 text-danger"
};

const statusStyles: Record<McplStatus, string> = {
  ready: "border-success/25 bg-success/10 text-success",
  watching: "border-warning/25 bg-warning/10 text-warning",
  review: "border-info/25 bg-info/10 text-info",
  experimental: "border-sub-org/25 bg-sub-org/10 text-sub-org",
  "needs-connection": "border-warning/25 bg-warning/10 text-warning",
  unavailable: "border-border bg-card text-muted"
};

const statusLabels: Record<McplStatus, string> = {
  ready: "ready",
  watching: "watching",
  review: "in review",
  experimental: "experimental",
  "needs-connection": "needs connection",
  unavailable: "unavailable"
};

const domainIcons: Record<McplDomain, typeof Sparkles> = {
  public: Sparkles,
  auth: KeyRound,
  identity: ShieldCheck,
  workspace: Waypoints,
  secrets: FolderKey,
  policy: ShieldCheck,
  connect: ArrowRight,
  ai: Cpu,
  operate: ShieldCheck
};

const domainTabs: Array<{ value: McplDomain | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "public", label: "Public" },
  { value: "auth", label: "Auth" },
  { value: "identity", label: "Identity" },
  { value: "connect", label: "Connect" },
  { value: "secrets", label: "Secrets" },
  { value: "policy", label: "Policy" },
  { value: "ai", label: "AI" },
  { value: "operate", label: "Operate" }
];

export type MCPLActionBoardProps = {
  actions?: readonly McplAction[];
  initialDomain?: McplDomain | "all";
  onAction?: (action: McplAction) => void;
  // Actions without a real destination render disabled instead of doing nothing.
  canRunAction?: (action: McplAction) => boolean;
};

export const MCPLActionBoard = ({
  actions = MCPL_ACTIONS,
  initialDomain = "all",
  onAction,
  canRunAction
}: MCPLActionBoardProps) => {
  const [selectedDomain, setSelectedDomain] = useState<McplDomain | "all">(initialDomain);

  const visibleActions = useMemo(
    () =>
      selectedDomain === "all"
        ? actions
        : actions.filter((action) => action.domain === selectedDomain),
    [actions, selectedDomain]
  );

  const visibleCount = visibleActions.length;

  return (
    <section className="w-full rounded-lg border border-border bg-card p-4 text-foreground shadow-sm">
      <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.12em] text-muted uppercase">MCPL</p>
          <h2 className="text-2xl font-semibold text-foreground">Scripted action library</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {domainTabs.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant={selectedDomain === value ? "project" : "outline"}
              size="sm"
              onClick={() => setSelectedDomain(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-container p-3">
          <p className="text-xs tracking-[0.12em] text-muted uppercase">Visible actions</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{visibleCount}</p>
        </div>
        <div className="rounded-md border border-border bg-container p-3">
          <p className="text-xs tracking-[0.12em] text-muted uppercase">Protected</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {actions.filter((action) => action.surface === "tenant").length}
          </p>
        </div>
        <div className="rounded-md border border-border bg-container p-3">
          <p className="text-xs tracking-[0.12em] text-muted uppercase">Experimental</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {actions.filter((action) => action.status === "experimental").length}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleActions.map((action) => {
          const Icon = domainIcons[action.domain];

          return (
            <article
              key={action.id}
              className="flex min-h-[220px] flex-col rounded-md border border-border bg-container p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`inline-flex rounded-md border p-2 ${domainStyles[action.domain]}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] font-medium tracking-[0.12em] uppercase ${statusStyles[action.status]}`}
                >
                  {statusLabels[action.status]}
                </span>
              </div>

              <div className="mt-4 flex-1">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-medium tracking-[0.14em] text-muted uppercase">
                  <span>{action.domain}</span>
                  <span>•</span>
                  <span>{action.surface}</span>
                </div>
                <h3 className="text-lg font-semibold text-foreground">{action.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{action.description}</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {action.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-card px-2 py-1 text-[10px] font-medium tracking-[0.08em] text-muted uppercase"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
                <div className="text-xs text-muted">{action.owner}</div>
                <Button
                  type="button"
                  variant="project"
                  size="sm"
                  onClick={() => onAction?.(action)}
                  isDisabled={!onAction || (canRunAction ? !canRunAction(action) : false)}
                  {...vaultixActionTrigger(action.id, {
                    scope: "mcpl-workbench",
                    target: action.id
                  })}
                >
                  {action.actionLabel}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default MCPLActionBoard;
