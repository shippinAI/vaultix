import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Info,
  Loader2,
  PlugZap,
  ShieldCheck
} from "lucide-react";

import { Badge, Button, Tooltip, TooltipContent, TooltipTrigger } from "@app/components/v3";
import type { TImportProviderId, TImportProviderRuntime } from "@app/hooks/api/migration/types";

import { vaultixActionTrigger } from "./action-trigger";
import { IMPORT_LIFECYCLE_HELP, IMPORT_PROVIDER_DETAILS } from "./mcpl-manifest";

// What the provider itself reports through the first usable connection.
export type ProviderSourceState =
  | { state: "none" }
  | { state: "loading" }
  | { state: "ready"; projectCount: number }
  | { state: "error"; message: string };

export type ProviderCardModel = {
  runtime: TImportProviderRuntime;
  source: ProviderSourceState;
};

export type ProviderImportStudioProps = {
  cards: readonly ProviderCardModel[];
  isLoading?: boolean;
  loadError?: string | null;
  // Set when this view has no destination folder, e.g. the instance workbench.
  reviewBlockedReason?: string | null;
  scope: string;
  onReview?: (provider: TImportProviderId) => void;
  onConnect?: (provider: TImportProviderId) => void;
};

const lifecycleTitles = { review: "Review", approve: "Approve", import: "Import" } as const;

const HelpTip = ({ label, help }: { label: string; help: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-[11px] text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {label}
        <Info className="size-3" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">{help}</TooltipContent>
  </Tooltip>
);

const connectionStatus = (card: ProviderCardModel) => {
  const { runtime, source } = card;
  if (runtime.unavailableReason)
    return {
      variant: "neutral" as const,
      icon: CircleAlert,
      label: "Unavailable",
      help: runtime.unavailableReason
    };
  if (!runtime.connections.length)
    return {
      variant: "neutral" as const,
      icon: CircleDashed,
      label: "Not connected",
      help: "Add a connection in Organization › App Connections, then come back to review an import."
    };
  if (source.state === "error")
    return {
      variant: "danger" as const,
      icon: CircleAlert,
      label: "Needs attention",
      help: source.message
    };
  const count = runtime.connections.length;
  return {
    variant: "success" as const,
    icon: CheckCircle2,
    label: count === 1 ? "Connected" : `${count} connections`,
    help: runtime.connections.map((connection) => connection.name).join(", ")
  };
};

const sourceLine = (card: ProviderCardModel) => {
  const { source } = card;
  if (source.state === "loading") return "Checking the provider…";
  if (source.state === "ready")
    return `${source.projectCount} ${source.projectCount === 1 ? "project" : "projects"} reachable`;
  if (source.state === "error") return "The provider didn't answer";
  return "No source yet";
};

const ProviderCard = ({
  card,
  reviewBlockedReason,
  scope,
  onReview,
  onConnect
}: {
  card: ProviderCardModel;
  reviewBlockedReason?: string | null;
  scope: string;
  onReview?: (provider: TImportProviderId) => void;
  onConnect?: (provider: TImportProviderId) => void;
}) => {
  const details = IMPORT_PROVIDER_DETAILS[card.runtime.provider];
  const status = connectionStatus(card);
  const StatusIcon = status.icon;
  let reviewDisabledReason: string | null = reviewBlockedReason ?? null;
  if (card.runtime.unavailableReason) reviewDisabledReason = card.runtime.unavailableReason;
  else if (!card.runtime.connections.length)
    reviewDisabledReason = `Connect ${details.name} first.`;
  const headingId = `provider-card-${card.runtime.provider}`;

  return (
    <article
      aria-labelledby={headingId}
      className="flex min-h-[300px] flex-col rounded-md border border-border bg-container p-4"
      data-provider={card.runtime.provider}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-border bg-foreground/80 p-1.5">
            <img src={details.image} alt="" className="size-full object-contain" />
          </div>
          <div>
            <h3 id={headingId} className="text-lg font-semibold text-foreground">
              {details.name}
            </h3>
            <p className="text-xs text-muted">{details.sourceShape}</p>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={status.variant} asChild>
              <button type="button" aria-label={`${details.name} status: ${status.label}`}>
                <StatusIcon />
                {status.label}
              </button>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{status.help}</TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-4 flex-1">
        <p className="text-sm text-foreground">{details.summary}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{details.worksWith}</p>
        <p className="mt-3 flex items-center gap-2 text-sm text-foreground" aria-live="polite">
          {card.source.state === "loading" && (
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {sourceLine(card)}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label={`${details.name} capabilities`}>
        {details.capabilities.map((capability) => (
          <HelpTip key={capability.label} label={capability.label} help={capability.help} />
        ))}
      </div>

      <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Import lifecycle">
        {card.runtime.lifecycle.map((step, index) => (
          <li key={step}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="block text-[10px] tracking-[0.12em] text-muted uppercase">
                    Step {index + 1}
                  </span>
                  <span className="block text-sm text-foreground">{lifecycleTitles[step]}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{IMPORT_LIFECYCLE_HELP[step]}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onConnect?.(card.runtime.provider)}
          isDisabled={!onConnect}
          {...vaultixActionTrigger(`${details.actionId}.connect`, {
            scope,
            target: card.runtime.provider
          })}
        >
          <PlugZap className="size-3.5" aria-hidden="true" />
          {card.runtime.connections.length ? "Manage connections" : "Connect"}
        </Button>
        <Tooltip open={reviewDisabledReason ? undefined : false}>
          <TooltipTrigger asChild>
            <span className="ml-auto">
              <Button
                type="button"
                variant="project"
                size="sm"
                isDisabled={Boolean(reviewDisabledReason) || !onReview}
                onClick={() => onReview?.(card.runtime.provider)}
                {...vaultixActionTrigger(`${details.actionId}.review`, {
                  scope,
                  target: card.runtime.provider
                })}
              >
                Review import
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{reviewDisabledReason}</TooltipContent>
        </Tooltip>
      </div>
    </article>
  );
};

export const ProviderImportStudio = ({
  cards,
  isLoading,
  loadError,
  reviewBlockedReason,
  scope,
  onReview,
  onConnect
}: ProviderImportStudioProps) => {
  const connected = cards.filter((card) => card.runtime.connections.length > 0).length;
  const connections = cards.reduce((sum, card) => sum + card.runtime.connections.length, 0);

  return (
    <section
      aria-labelledby="provider-import-heading"
      className="w-full rounded-lg border border-border bg-card p-4 text-foreground"
    >
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">Import</p>
          <h2 id="provider-import-heading" className="mt-1 text-xl font-semibold text-foreground">
            Bring secrets from another provider
          </h2>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="success" asChild>
              <button type="button">
                <ShieldCheck />
                Values stay on the server
              </button>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Vaultix reads the provider on the server. Review shows secret names only, and values go
            straight into encrypted storage. They never reach this page, chat or AI context.
          </TooltipContent>
        </Tooltip>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-container p-3">
          <dt className="text-xs tracking-[0.12em] text-muted uppercase">Providers connected</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {isLoading ? "…" : `${connected} of ${cards.length}`}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-container p-3">
          <dt className="text-xs tracking-[0.12em] text-muted uppercase">Usable connections</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {isLoading ? "…" : connections}
          </dd>
        </div>
      </dl>

      {loadError && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm"
        >
          {loadError}
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <ProviderCard
            key={card.runtime.provider}
            card={card}
            reviewBlockedReason={reviewBlockedReason}
            scope={scope}
            onReview={onReview}
            onConnect={onConnect}
          />
        ))}
      </div>
    </section>
  );
};

export default ProviderImportStudio;
