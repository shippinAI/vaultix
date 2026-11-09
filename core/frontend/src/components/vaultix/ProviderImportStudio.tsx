import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Globe2, ShieldCheck, Sparkles, Wifi } from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";

export type ProviderImportLifecycleStep = "preview" | "approve" | "import" | "complete";

export type ProviderImportDefinition = {
  id: string;
  name: string;
  provider: "doppler" | "infisical" | "vaultix" | "local-ai";
  status: "connected" | "needs-review" | "sandbox";
  description: string;
  lastSync: string;
  projectCount: number;
  environmentCount: number;
  capabilities: readonly string[];
  lifecycle?: readonly ProviderImportLifecycleStep[];
  importPolicy?: {
    previewRequired: boolean;
    approvalRequired: boolean;
    referenceSafe: boolean;
    syncMode: "dry-run" | "review" | "approved";
  };
};

export type ProviderImportStudioProps = {
  providers?: readonly ProviderImportDefinition[];
  onConnect?: (provider: ProviderImportDefinition) => void;
  onPreview?: (provider: ProviderImportDefinition) => void;
  onImport?: (provider: ProviderImportDefinition) => void;
};

const statusStyles = {
  connected: "border-success/25 bg-success/10 text-success",
  "needs-review": "border-warning/25 bg-warning/10 text-warning",
  sandbox: "border-sub-org/25 bg-sub-org/10 text-sub-org"
} as const;

const providerIconStyles = {
  doppler: "border-warning/25 bg-warning/10 text-warning",
  infisical: "border-info/25 bg-info/10 text-info",
  vaultix: "border-project/25 bg-project/10 text-project",
  "local-ai": "border-sub-org/25 bg-sub-org/10 text-sub-org"
} as const;

const lifecycleTitles: Record<ProviderImportLifecycleStep, string> = {
  preview: "Review imports",
  approve: "Approve mapping",
  import: "Apply reference-safe sync",
  complete: "Finalize and audit"
};

const defaultProviders: readonly ProviderImportDefinition[] = [
  {
    id: "doppler",
    name: "Doppler",
    provider: "doppler",
    status: "connected",
    description: "Secrets and environments from your hosted Doppler workspace.",
    lastSync: "2 minutes ago",
    projectCount: 5,
    environmentCount: 12,
    capabilities: ["Project import", "Env mapping", "Approval gate"],
    lifecycle: ["preview", "approve", "import"],
    importPolicy: {
      previewRequired: true,
      approvalRequired: true,
      referenceSafe: true,
      syncMode: "review"
    }
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
    capabilities: ["Project import", "Value preview", "Scoped policies"],
    lifecycle: ["preview", "approve", "import", "complete"],
    importPolicy: {
      previewRequired: true,
      approvalRequired: true,
      referenceSafe: true,
      syncMode: "review"
    }
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
    capabilities: ["Dry run", "Reference-only", "Prompt isolation"],
    lifecycle: ["preview", "approve", "import"],
    importPolicy: {
      previewRequired: true,
      approvalRequired: true,
      referenceSafe: true,
      syncMode: "dry-run"
    }
  }
] as const satisfies readonly ProviderImportDefinition[];

export const ProviderImportStudio = ({
  providers = defaultProviders,
  onConnect,
  onPreview,
  onImport
}: ProviderImportStudioProps) => {
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id ?? "");
  const [currentStep, setCurrentStep] = useState<ProviderImportLifecycleStep>("preview");

  const connectedCount = providers.filter((provider) => provider.status === "connected").length;
  const reviewCount = providers.filter((provider) => provider.status === "needs-review").length;

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId]
  );

  const lifecycleSteps = selectedProvider?.lifecycle ?? ["preview", "approve", "import"];

  const handlePreview = (provider: ProviderImportDefinition) => {
    setSelectedProviderId(provider.id);
    setCurrentStep("preview");
    onPreview?.(provider);
  };

  const handleConnect = (provider: ProviderImportDefinition) => {
    setSelectedProviderId(provider.id);
    setCurrentStep("approve");
    onConnect?.(provider);
  };

  const handleImport = (provider: ProviderImportDefinition) => {
    setSelectedProviderId(provider.id);
    setCurrentStep("import");
    onImport?.(provider);
  };

  return (
    <section className="w-full rounded-lg border border-border bg-card p-4 text-foreground">
      <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Import layer</p>
          <h2 className="mt-2 text-2xl font-semibold text-foreground">Provider import studio</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm">
            <Globe2 className="size-3.5" />
            Review sync health
          </Button>
          <Button type="button" variant="project" size="sm">
            <Sparkles className="size-3.5" />
            Run dry run
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-container p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-muted">Connected</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{connectedCount}</p>
        </div>
        <div className="rounded-md border border-border bg-container p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-muted">Needs review</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{reviewCount}</p>
        </div>
        <div className="rounded-md border border-border bg-container p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-muted">Protected</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">Reference-only</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {providers.map((provider) => (
          <article
            key={provider.id}
            className={`flex min-h-[260px] flex-col rounded-md border bg-container p-4 ${
              selectedProvider?.id === provider.id ? "border-project/30" : "border-border"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className={`inline-flex rounded-md border p-2 ${providerIconStyles[provider.provider]}`}
              >
                <Wifi className="size-4" aria-hidden="true" />
              </div>
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${statusStyles[provider.status]}`}
              >
                {provider.status}
              </span>
            </div>

            <div className="mt-4 flex-1">
              <h3 className="text-xl font-semibold text-foreground">{provider.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{provider.description}</p>

              <dl className="mt-4 space-y-2 text-sm text-foreground">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Last sync</dt>
                  <dd>{provider.lastSync}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Projects</dt>
                  <dd>{provider.projectCount}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Environments</dt>
                  <dd>{provider.environmentCount}</dd>
                </div>
              </dl>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {provider.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="rounded-full border border-border bg-card px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted"
                >
                  {capability}
                </span>
              ))}
            </div>

            <div className="mt-4 flex gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePreview(provider)}
              >
                Preview
              </Button>
              <Button
                type="button"
                variant="project"
                size="sm"
                onClick={() => handleConnect(provider)}
              >
                Connect
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => handleImport(provider)}
              >
                Import
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </article>
        ))}
      </div>

      {selectedProvider && (
        <div className="mt-5 rounded-md border border-border bg-container p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
              {selectedProvider.name} import flow
            </div>
            <span className="text-xs uppercase tracking-[0.12em] text-muted">
              {selectedProvider.importPolicy?.syncMode ?? "review"}
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {lifecycleSteps.map((step, index) => {
              const isActive = step === currentStep;
              const isDone = lifecycleSteps.indexOf(currentStep) >= index;

              return (
                <div
                  key={step}
                  className={`rounded-md border p-3 ${
                    isActive
                      ? "border-project/30 bg-project/10"
                      : isDone
                        ? "border-success/20 bg-success/5"
                        : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-muted">
                    <span>Step {index + 1}</span>
                    {isDone && <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />}
                  </div>
                  <p className="mt-2 text-sm font-medium text-foreground">{lifecycleTitles[step]}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-md border border-border bg-container p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="size-4 text-success" aria-hidden="true" />
          Secure import contract
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Imports are previewed, mapped to Vaultix projects and environments, and applied only after
          approval. Sensitive values never appear in chat or general AI context unless a scoped
          secret reference is explicitly approved.
        </p>
        <div className="mt-3 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Reference-only execution remains the default safety model.
        </div>
      </div>
    </section>
  );
};

export default ProviderImportStudio;
