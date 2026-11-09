import { ArrowRight, CheckCircle2, Globe2, ShieldCheck, Sparkles, Wifi } from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";

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

export const ProviderImportStudio = ({
  providers = [
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
  ],
  onConnect,
  onPreview,
  onImport
}: ProviderImportStudioProps) => {
  const connectedCount = providers.filter((provider) => provider.status === "connected").length;
  const reviewCount = providers.filter((provider) => provider.status === "needs-review").length;

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
            className="flex min-h-[260px] flex-col rounded-md border border-border bg-container p-4"
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
                onClick={() => onPreview?.(provider)}
              >
                Preview
              </Button>
              <Button
                type="button"
                variant="project"
                size="sm"
                onClick={() => onConnect?.(provider)}
              >
                Connect
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => onImport?.(provider)}
              >
                Import
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </article>
        ))}
      </div>

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
