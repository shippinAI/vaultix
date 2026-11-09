import { useEffect, useMemo, useState } from "react";
import { Activity, Settings2, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";

import { MCPLActionBoard } from "./MCPLActionBoard";
import {
  DEFAULT_MCPL_MODULES,
  MCPL_ACTIONS,
  MCPL_PROVIDER_ADAPTERS,
  createMcplRuntimeRegistry,
  type McplAction,
  type McplProviderRuntime,
  type McplWorkbenchModule
} from "./mcpl-manifest";
import { ProviderImportStudio } from "./ProviderImportStudio";
import { VaultixAmbientBackground } from "./VaultixAmbientBackground";

export type MCPLWorkbenchProps = {
  actions?: readonly McplAction[];
  modules?: readonly McplWorkbenchModule[];
  providers?: readonly McplProviderRuntime[];
};

export const MCPLWorkbench = ({
  actions = MCPL_ACTIONS,
  modules = DEFAULT_MCPL_MODULES,
  providers = MCPL_PROVIDER_ADAPTERS
}: MCPLWorkbenchProps) => {
  const runtime = useMemo(
    () => createMcplRuntimeRegistry({ actions, modules, providers }),
    [actions, modules, providers]
  );

  const [moduleState, setModuleState] = useState(
    () => new Map(runtime.modules.map((module) => [module.id, module.enabled]))
  );

  useEffect(() => {
    setModuleState((current) => {
      const next = new Map(current);
      for (const module of runtime.modules) {
        next.set(module.id, next.get(module.id) ?? module.enabled);
      }
      return next;
    });
  }, [runtime.modules]);

  const activeActions = useMemo(
    () =>
      runtime.actions.filter((action) => {
        const isEnabled = moduleState.get(action.domain) ?? false;
        return isEnabled;
      }),
    [moduleState, runtime.actions]
  );

  const enabledModules = runtime.modules.filter((module) => moduleState.get(module.id) ?? false);

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-[#0f0d0b] text-foreground shadow-[0_0_55px_rgba(232,120,56,0.12)]">
      <div className="absolute inset-0 opacity-90">
        <VaultixAmbientBackground className="h-full w-full" mode="identity" />
      </div>

      <div className="relative z-10 p-4">
        <div className="flex flex-col gap-4 border-b border-border/80 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Workbench</p>
            <h2 className="mt-2 text-3xl font-semibold text-foreground">MCPL runtime</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm">
              <Settings2 className="size-3.5" />
              Configure registry
            </Button>
            <Button type="button" variant="project" size="sm">
              <Sparkles className="size-3.5" />
              Run rehearsal
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[320px_1fr]">
          <aside className="rounded-md border border-border/80 bg-[#17130f]/80 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="size-4 text-project" aria-hidden="true" />
              Enabled modules
            </div>
            <div className="mt-4 space-y-3">
              {runtime.modules.map((module) => {
                const isEnabled = moduleState.get(module.id) ?? false;
                return (
                  <button
                    key={module.id}
                    type="button"
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      isEnabled
                        ? "border-project/30 bg-project/10 text-foreground"
                        : "border-border bg-card/60 text-muted"
                    }`}
                    onClick={() =>
                      setModuleState((current) => {
                        const next = new Map(current);
                        next.set(module.id, !(next.get(module.id) ?? false));
                        return next;
                      })
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{module.label}</span>
                      <span className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]">
                        {isEnabled ? "on" : "off"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-current/80">{module.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-md border border-border/80 bg-card/70 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldCheck className="size-4 text-success" aria-hidden="true" />
                Safety mode
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Secret values stay behind references. Provider keys are managed from admin and the
                AI can only run approved actions in the active workflow registry.
              </p>
            </div>
          </aside>

          <div>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border/80 bg-[#17130f]/75 p-3 backdrop-blur-sm">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-muted">Active registry</p>
                <p className="mt-1 text-sm text-foreground">
                  {enabledModules.length} modules enabled · {activeActions.length} actions visible
                </p>
              </div>
              <span className="rounded-full border border-border bg-card/70 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                Schema-driven
              </span>
            </div>

            <MCPLActionBoard actions={activeActions} />
            <div className="mt-5">
              <ProviderImportStudio providers={runtime.providers} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MCPLWorkbench;
