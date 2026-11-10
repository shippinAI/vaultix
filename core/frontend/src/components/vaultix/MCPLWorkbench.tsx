import { useMemo, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";

import type { TImportProviderId } from "@app/hooks/api/migration/types";

import {
  DEFAULT_MCPL_MODULES,
  MCPL_ACTIONS,
  type McplAction,
  type McplWorkbenchModule
} from "./mcpl-manifest";
import { MCPLActionBoard } from "./MCPLActionBoard";
import { type ProviderCardModel, ProviderImportStudio } from "./ProviderImportStudio";
import { VaultixAmbientBackground } from "./VaultixAmbientBackground";

export type MCPLWorkbenchProps = {
  // Actions with runtime status already resolved (see resolveMcplActions).
  actions?: readonly McplAction[];
  modules?: readonly McplWorkbenchModule[];
  providerCards: readonly ProviderCardModel[];
  isProvidersLoading?: boolean;
  providersError?: string | null;
  onAction?: (action: McplAction) => void;
  canRunAction?: (action: McplAction) => boolean;
  onConnect?: (provider: TImportProviderId) => void;
};

export const MCPLWorkbench = ({
  actions = MCPL_ACTIONS,
  modules = DEFAULT_MCPL_MODULES,
  providerCards,
  isProvidersLoading,
  providersError,
  onAction,
  canRunAction,
  onConnect
}: MCPLWorkbenchProps) => {
  // A view filter for this page only; it does not enable or disable anything on the server.
  const [shown, setShown] = useState(
    () => new Map(modules.map((module) => [module.id, module.enabled]))
  );

  const visibleActions = useMemo(
    () => actions.filter((action) => shown.get(action.domain) ?? true),
    [actions, shown]
  );
  const readyCount = actions.filter((action) => action.status === "ready").length;

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-[#0f0d0b] text-foreground shadow-[0_0_55px_rgba(232,120,56,0.12)]">
      <div className="absolute inset-0 opacity-90">
        <VaultixAmbientBackground className="h-full w-full" mode="identity" />
      </div>

      <div className="relative z-10 p-4">
        <div className="flex flex-col gap-2 border-b border-border/80 pb-4">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Workbench</p>
          <h2 className="text-3xl font-semibold text-foreground">MCPL runtime</h2>
          <p className="text-sm text-muted">
            {readyCount} of {actions.length} actions ready on this instance. Provider status comes
            from your real connections.
          </p>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[320px_1fr]">
          <aside className="rounded-md border border-border/80 bg-[#17130f]/80 p-4 backdrop-blur-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="size-4 text-project" aria-hidden="true" />
              Show modules
            </h3>
            <div className="mt-4 space-y-3">
              {modules.map((module) => {
                const isShown = shown.get(module.id) ?? true;
                return (
                  <button
                    key={module.id}
                    type="button"
                    aria-pressed={isShown}
                    className={`w-full rounded-md border p-3 text-left transition-colors motion-reduce:transition-none ${
                      isShown
                        ? "border-project/30 bg-project/10 text-foreground"
                        : "border-border bg-card/60 text-muted"
                    }`}
                    onClick={() => setShown((current) => new Map(current).set(module.id, !isShown))}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{module.label}</span>
                      <span className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase">
                        {isShown ? "shown" : "hidden"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-current/80">
                      {module.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-md border border-border/80 bg-card/70 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldCheck className="size-4 text-success" aria-hidden="true" />
                Safety mode
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Secret values stay behind references. Imports show names only and write values on
                the server, and every import needs a human approval in the product.
              </p>
            </div>
          </aside>

          <div>
            <MCPLActionBoard
              actions={visibleActions}
              onAction={onAction}
              canRunAction={canRunAction}
            />
            <div className="mt-5">
              <ProviderImportStudio
                cards={providerCards}
                isLoading={isProvidersLoading}
                loadError={providersError}
                scope="mcpl-workbench"
                reviewBlockedReason="Open a project's secrets to choose where the import goes."
                onConnect={onConnect}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MCPLWorkbench;
