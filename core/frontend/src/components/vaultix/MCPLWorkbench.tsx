import { useMemo, useState } from "react";
import { Activity, Settings2, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";

import { MCPLActionBoard } from "./MCPLActionBoard";
import { MCPL_ACTIONS, type McplAction, type McplDomain } from "./mcpl-manifest";
import { ProviderImportStudio } from "./ProviderImportStudio";
import { VaultixAmbientBackground } from "./VaultixAmbientBackground";

type WorkbenchModule = {
  id: McplDomain;
  label: string;
  enabled: boolean;
  description: string;
};

const defaultModules: readonly WorkbenchModule[] = [
  {
    id: "public",
    label: "Public rehearsal",
    enabled: true,
    description: "Landing flows and guided onboarding"
  },
  {
    id: "auth",
    label: "Auth admin",
    enabled: true,
    description: "Provider keys and credential policy"
  },
  {
    id: "connect",
    label: "Connectors",
    enabled: true,
    description: "Doppler, Infisical, provider imports"
  },
  {
    id: "secrets",
    label: "Secrets",
    enabled: true,
    description: "References, env mapping and value handling"
  },
  {
    id: "ai",
    label: "AI sandbox",
    enabled: false,
    description: "Local AI and controlled sandbox execution"
  },
  {
    id: "operate",
    label: "Operations",
    enabled: true,
    description: "Receipts, audits and review flows"
  }
];

export type MCPLWorkbenchProps = {
  actions?: readonly McplAction[];
  modules?: readonly WorkbenchModule[];
};

export const MCPLWorkbench = ({
  actions = MCPL_ACTIONS,
  modules = defaultModules
}: MCPLWorkbenchProps) => {
  const [moduleState, setModuleState] = useState(() => new Map(modules.map((module) => [module.id, module.enabled])));

  const activeActions = useMemo(
    () =>
      actions.filter((action) => {
        const isEnabled = moduleState.get(action.domain) ?? false;
        return isEnabled;
      }),
    [actions, moduleState]
  );

  const enabledModules = modules.filter((module) => moduleState.get(module.id) ?? false);

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
              {modules.map((module) => {
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
              <ProviderImportStudio
                providers={[
                  {
                    id: "doppler",
                    name: "Doppler",
                    provider: "doppler",
                    status: "connected",
                    description: "Secrets and environments from your hosted Doppler workspace.",
                    lastSync: "2 minutes ago",
                    projectCount: 5,
                    environmentCount: 12,
                    capabilities: ["Project import", "Env mapping", "Approval gate"]
                  },
                  {
                    id: "infisical",
                    name: "Infisical",
                    provider: "infisical",
                    status: "needs-review",
                    description: "Import project metadata and values with scoped review before apply.",
                    lastSync: "18 minutes ago",
                    projectCount: 3,
                    environmentCount: 8,
                    capabilities: ["Project import", "Value preview", "Scoped policies"]
                  },
                  {
                    id: "local-ai",
                    name: "Local AI Sandbox",
                    provider: "local-ai",
                    status: "sandbox",
                    description: "Use a sandboxed local model to test the safest secret-handling patterns.",
                    lastSync: "Ready",
                    projectCount: 1,
                    environmentCount: 3,
                    capabilities: ["Dry run", "Reference-only", "Prompt isolation"]
                  }
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MCPLWorkbench;
