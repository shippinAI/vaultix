import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AxiosError } from "axios";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  GitPullRequest,
  Loader2,
  ShieldCheck
} from "lucide-react";

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldLabel,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3";
import { FilterableSelect } from "@app/components/v3/generic/ReactSelect";
import { useOrganization } from "@app/context";
import {
  useExternalVaultixConnectionGetEnvironmentFolderTree,
  useExternalVaultixConnectionListProjects
} from "@app/hooks/api/appConnections/external-vaultix";
import {
  useGetDopplerConfigs,
  useGetDopplerProjects,
  useImportProviderSecrets,
  useReviewProviderImport
} from "@app/hooks/api/migration";
import {
  ExternalMigrationImportStatus,
  TImportKeyAction,
  TImportProviderId,
  TProviderImportResult,
  TProviderImportReview,
  TProviderImportSpec
} from "@app/hooks/api/migration/types";

import { vaultixActionTrigger } from "./action-trigger";
import { IMPORT_PROVIDER_DETAILS } from "./mcpl-manifest";
import { ProviderImportStudio } from "./ProviderImportStudio";
import { apiErrorMessage, useProviderImportRuntime } from "./use-provider-import-runtime";

type Step = "choose" | "source" | "review" | "approve" | "result";
type Option = { value: string; label: string; group?: string };

const STEPS: Array<{ id: Exclude<Step, "choose">; title: string }> = [
  { id: "source", title: "Source" },
  { id: "review", title: "Review" },
  { id: "approve", title: "Approve" },
  { id: "result", title: "Import" }
];

const ACTION_COPY: Record<
  TImportKeyAction,
  { label: string; variant: "success" | "neutral" | "warning" | "danger"; help: string }
> = {
  create: {
    label: "New",
    variant: "success",
    help: "Not in the destination yet. It can be imported."
  },
  exists: {
    label: "Already here",
    variant: "neutral",
    help: "A secret with this name already exists in the destination. It is left unchanged."
  },
  denied: {
    label: "Not allowed",
    variant: "warning",
    help: "Your role can't create this secret in the destination folder."
  },
  unreadable: {
    label: "Unreadable",
    variant: "danger",
    help: "The source connection can't read this value, so it can't be imported."
  }
};

const ACTION_SCOPE = "secrets-overview";

const PREVIOUS_STEP: Record<Step, Step> = {
  choose: "choose",
  source: "choose",
  review: "source",
  approve: "review",
  result: "result"
};

const stepClass = (index: number, currentIndex: number) => {
  if (index === currentIndex) return "border-project/40 bg-project/10 text-foreground";
  if (index < currentIndex) return "border-success/25 bg-success/5 text-foreground";
  return "border-border text-muted";
};

const singleValue = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Option | null;

const isStaleError = (error: unknown) =>
  error instanceof AxiosError &&
  (error.response?.data as { error?: string } | undefined)?.error === "StaleImportReview";

type Props = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  projectId: string;
  environment: string;
  secretPath: string;
  initialProvider?: TImportProviderId | null;
};

export const ProviderImportDialog = ({
  isOpen,
  onOpenChange,
  projectId,
  environment,
  secretPath,
  initialProvider = null
}: Props) => {
  const navigate = useNavigate();
  const { currentOrg } = useOrganization();
  const { runtime, cards, isLoading, loadError } = useProviderImportRuntime(projectId);

  const [step, setStep] = useState<Step>(initialProvider ? "source" : "choose");
  const [provider, setProvider] = useState<TImportProviderId | null>(initialProvider);
  const [connectionId, setConnectionId] = useState("");
  const [sourceProject, setSourceProject] = useState("");
  const [sourceEnvironment, setSourceEnvironment] = useState("");
  const [sourcePath, setSourcePath] = useState("/");
  const [review, setReview] = useState<TProviderImportReview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<TProviderImportResult | null>(null);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);

  const reviewMutation = useReviewProviderImport();
  const importMutation = useImportProviderSecrets();

  const connections = useMemo(
    () => runtime?.find((entry) => entry.provider === provider)?.connections ?? [],
    [runtime, provider]
  );

  useEffect(() => {
    if (!isOpen) return;
    setStep(initialProvider ? "source" : "choose");
    setProvider(initialProvider);
    setSourceProject("");
    setSourceEnvironment("");
    setSourcePath("/");
    setReview(null);
    setSelected(new Set());
    setResult(null);
    setError(null);
  }, [isOpen, initialProvider]);

  useEffect(() => {
    setConnectionId(connections.length === 1 ? connections[0].id : "");
  }, [connections]);

  const isDoppler = provider === "doppler";
  const isInstance = provider === "external-vaultix";
  const details = provider ? IMPORT_PROVIDER_DETAILS[provider] : null;

  const dopplerProjects = useGetDopplerProjects(isDoppler ? connectionId || undefined : undefined);
  const dopplerConfigs = useGetDopplerConfigs(
    isDoppler ? connectionId || undefined : undefined,
    isDoppler ? sourceProject || undefined : undefined
  );
  const instanceProjects = useExternalVaultixConnectionListProjects(connectionId, {
    enabled: isInstance && Boolean(connectionId),
    retry: false
  });
  const instanceFolders = useExternalVaultixConnectionGetEnvironmentFolderTree(
    connectionId,
    sourceProject,
    { enabled: isInstance && Boolean(connectionId) && Boolean(sourceProject), retry: false }
  );

  const projectOptions: Option[] = useMemo(() => {
    if (isDoppler)
      return (dopplerProjects.data ?? []).map((p) => ({ value: p.slug, label: p.name }));
    if (isInstance)
      return (instanceProjects.data ?? []).map((p) => ({ value: p.id, label: p.name }));
    return [];
  }, [isDoppler, isInstance, dopplerProjects.data, instanceProjects.data]);

  const environmentOptions: Option[] = useMemo(() => {
    if (isDoppler)
      return [...(dopplerConfigs.data ?? [])]
        .sort((a, b) => a.environment.localeCompare(b.environment) || a.name.localeCompare(b.name))
        .map((config) => ({ value: config.name, label: config.name, group: config.environment }));
    if (isInstance)
      return (instanceProjects.data?.find((p) => p.id === sourceProject)?.environments ?? []).map(
        (env) => ({ value: env.slug, label: env.name })
      );
    return [];
  }, [isDoppler, isInstance, dopplerConfigs.data, instanceProjects.data, sourceProject]);

  const folderOptions: Option[] = useMemo(() => {
    if (!isInstance || !sourceEnvironment) return [];
    const env = Object.values(instanceFolders.data ?? {}).find((e) => e.slug === sourceEnvironment);
    const paths = new Set(["/", ...(env?.folders ?? []).map((folder) => folder.path || "/")]);
    return [...paths].sort().map((path) => ({ value: path, label: path }));
  }, [isInstance, sourceEnvironment, instanceFolders.data]);

  const sourceError =
    (isDoppler && (dopplerProjects.error || dopplerConfigs.error)) ||
    (isInstance && (instanceProjects.error || instanceFolders.error)) ||
    null;

  const spec: TProviderImportSpec | null =
    provider && connectionId && sourceProject && sourceEnvironment
      ? {
          provider,
          connectionId,
          source: {
            project: sourceProject,
            environment: sourceEnvironment,
            secretPath: isInstance ? sourcePath : "/"
          },
          target: { projectId, environment, secretPath }
        }
      : null;

  const runReview = async () => {
    if (!spec) return;
    setError(null);
    try {
      const next = await reviewMutation.mutateAsync(spec);
      setReview(next);
      setSelected(new Set(next.keys.filter((k) => k.action === "create").map((k) => k.key)));
      setResult(null);
      setStep("review");
    } catch (err) {
      setError({ message: apiErrorMessage(err, "The review failed."), stale: false });
    }
  };

  const runImport = async () => {
    if (!spec || !selected.size) return;
    setError(null);
    try {
      const next = await importMutation.mutateAsync({ ...spec, keys: [...selected] });
      setResult(next);
      setStep("result");
    } catch (err) {
      setError({ message: apiErrorMessage(err, "The import failed."), stale: isStaleError(err) });
    }
  };

  const goToConnections = () => {
    onOpenChange(false);
    navigate({ to: "/organizations/$orgId/app-connections", params: { orgId: currentOrg.id } });
  };

  const creatable = review?.keys.filter((k) => k.action === "create") ?? [];
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        showCloseButton
        // Focus the dialog itself so opening it does not pop a tooltip on the first control.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.target as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {details ? `Import from ${details.name}` : "Import from another provider"}
          </DialogTitle>
          <DialogDescription>
            Into environment <code className="text-xs">{environment}</code> at{" "}
            <code className="text-xs">{secretPath}</code>. You review names and approve them before
            anything is written.
          </DialogDescription>
        </DialogHeader>

        {step !== "choose" && (
          <ol className="mb-2 grid grid-cols-4 gap-2" aria-label="Import progress">
            {STEPS.map((s, index) => (
              <li
                key={s.id}
                aria-current={s.id === step ? "step" : undefined}
                className={`rounded-md border px-2 py-1.5 text-sm ${stepClass(index, currentIndex)}`}
              >
                <span className="block text-[10px] tracking-[0.12em] uppercase">
                  Step {index + 1}
                </span>
                {s.title}
              </li>
            ))}
          </ol>
        )}

        {step === "choose" && (
          <ProviderImportStudio
            cards={cards}
            isLoading={isLoading}
            loadError={loadError}
            scope={ACTION_SCOPE}
            onConnect={goToConnections}
            onReview={(next) => {
              setProvider(next);
              setStep("source");
            }}
          />
        )}

        {step === "source" && details && (
          <div className="space-y-4">
            {connections.length > 1 && (
              <Field>
                <FieldLabel>Connection</FieldLabel>
                <FieldContent>
                  <FilterableSelect
                    value={
                      connections
                        .map((c) => ({ value: c.id, label: c.name }))
                        .find((o) => o.value === connectionId) ?? null
                    }
                    onChange={(value) => {
                      setConnectionId(singleValue(value)?.value ?? "");
                      setSourceProject("");
                      setSourceEnvironment("");
                    }}
                    options={connections.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="Select a connection…"
                  />
                </FieldContent>
              </Field>
            )}
            {connections.length === 0 && !isLoading && (
              <p className="rounded-md border border-border bg-container p-3 text-sm">
                No usable {details.name} connection for this project.{" "}
                <Button type="button" variant="outline" size="xs" onClick={goToConnections}>
                  Add a connection
                </Button>
              </p>
            )}
            <Field>
              <FieldLabel>{details.projectLabel}</FieldLabel>
              <FieldContent>
                <FilterableSelect
                  value={projectOptions.find((o) => o.value === sourceProject) ?? null}
                  onChange={(value) => {
                    setSourceProject(singleValue(value)?.value ?? "");
                    setSourceEnvironment("");
                    setSourcePath("/");
                  }}
                  options={projectOptions}
                  isDisabled={!connectionId}
                  isLoading={
                    Boolean(connectionId) &&
                    (isDoppler ? dopplerProjects.isPending : instanceProjects.isPending)
                  }
                  placeholder="Select a project…"
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{details.environmentLabel}</FieldLabel>
              <FieldContent>
                <FilterableSelect
                  value={environmentOptions.find((o) => o.value === sourceEnvironment) ?? null}
                  onChange={(value) => {
                    setSourceEnvironment(singleValue(value)?.value ?? "");
                    setSourcePath("/");
                  }}
                  options={environmentOptions}
                  groupBy={isDoppler ? "group" : undefined}
                  isDisabled={!sourceProject}
                  isLoading={isDoppler && Boolean(sourceProject) && dopplerConfigs.isPending}
                  placeholder={isDoppler ? "Select a config…" : "Select an environment…"}
                />
              </FieldContent>
            </Field>
            {isInstance && (
              <Field>
                <FieldLabel>Source folder</FieldLabel>
                <FieldContent>
                  <FilterableSelect
                    value={folderOptions.find((o) => o.value === sourcePath) ?? null}
                    onChange={(value) => setSourcePath(singleValue(value)?.value ?? "/")}
                    options={folderOptions}
                    isDisabled={!sourceEnvironment}
                    isLoading={Boolean(sourceEnvironment) && instanceFolders.isPending}
                    placeholder="/"
                  />
                </FieldContent>
              </Field>
            )}
            {sourceError && (
              <p
                role="alert"
                className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm"
              >
                {apiErrorMessage(sourceError, "The provider didn't answer.")}
              </p>
            )}
          </div>
        )}

        {step === "review" && review && details && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm" aria-live="polite">
              <Badge variant="neutral">{review.sourceCount} in source</Badge>
              <Badge variant="success">{review.createCount} new</Badge>
              <Badge variant="neutral">{review.existingCount} already here</Badge>
              <Badge variant="project">{selected.size} selected</Badge>
            </div>
            {review.approvalRequired && (
              <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <GitPullRequest className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                This folder is governed by the approval policy{" "}
                <strong>{review.approvalPolicyName ?? "in place"}</strong>. Importing opens a change
                request, and nothing is written until approvers accept it.
              </p>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setSelected(new Set(creatable.map((k) => k.key)))}
                isDisabled={!creatable.length}
              >
                Select all new
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setSelected(new Set())}
                isDisabled={!selected.size}
              >
                Clear
              </Button>
            </div>
            <ul
              className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border"
              aria-label="Secret names in the source"
            >
              {review.keys.length === 0 && (
                <li className="p-3 text-sm text-muted">The source folder has no secrets.</li>
              )}
              {review.keys.map(({ key, action }) => {
                const copy = ACTION_COPY[action];
                const checkboxId = `import-key-${key}`;
                return (
                  <li key={key} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={checkboxId}
                      isChecked={selected.has(key)}
                      isDisabled={action !== "create"}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(key);
                          else next.delete(key);
                          return next;
                        })
                      }
                      aria-label={`Import ${key}`}
                    />
                    <label htmlFor={checkboxId} className="flex-1 truncate font-mono text-sm">
                      {key}
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant={copy.variant} asChild>
                          <button type="button">{copy.label}</button>
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{copy.help}</TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step === "approve" && review && details && (
          <div className="space-y-3 rounded-md border border-border bg-container p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
              You&apos;re approving {selected.size} {selected.size === 1 ? "secret" : "secrets"}
            </p>
            <p className="text-muted">
              From {details.name} <code className="text-xs">{sourceProject}</code> /{" "}
              <code className="text-xs">{sourceEnvironment}</code>
              {isInstance ? (
                <>
                  {" "}
                  at <code className="text-xs">{sourcePath}</code>
                </>
              ) : null}{" "}
              into <code className="text-xs">{environment}</code> at{" "}
              <code className="text-xs">{secretPath}</code>.
            </p>
            <p className="text-muted">
              {review.approvalRequired
                ? "A change request will be opened. Approvers must accept it before the secrets exist here."
                : "The secrets are written directly, encrypted, and recorded in the audit log."}
            </p>
            <p className="font-mono text-xs break-words text-foreground/80">
              {[...selected].sort().join(", ")}
            </p>
          </div>
        )}

        {step === "result" && result && (
          <div
            className="space-y-2 rounded-md border border-border bg-container p-4 text-sm"
            role="status"
          >
            {result.status === ExternalMigrationImportStatus.ApprovalRequired ? (
              <p className="flex items-center gap-2 text-foreground">
                <GitPullRequest className="size-4" aria-hidden="true" />
                Change request opened for {selected.size}{" "}
                {selected.size === 1 ? "secret" : "secrets"}. They&apos;ll be written once approvers
                accept it.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-foreground">
                <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                Imported {result.imported} {result.imported === 1 ? "secret" : "secrets"}
                {result.skipped ? `, left ${result.skipped} unselected` : ""}.
              </p>
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error.message}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {(step === "review" || step === "approve" || (step === "source" && !initialProvider)) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(PREVIOUS_STEP[step]);
              }}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back
            </Button>
          )}
          {step === "source" && (
            <Button
              type="button"
              variant="project"
              isDisabled={!spec || reviewMutation.isPending}
              isPending={reviewMutation.isPending}
              onClick={runReview}
              {...vaultixActionTrigger("vaultix.ui.connect.import.review", {
                scope: ACTION_SCOPE,
                target: provider ?? undefined
              })}
            >
              Review names
            </Button>
          )}
          {step === "review" && (
            <Button
              type="button"
              variant="project"
              isDisabled={!selected.size}
              onClick={() => {
                setError(null);
                setStep("approve");
              }}
              {...vaultixActionTrigger("vaultix.ui.connect.import.approve", {
                scope: ACTION_SCOPE,
                target: provider ?? undefined
              })}
            >
              Approve {selected.size} {selected.size === 1 ? "secret" : "secrets"}
            </Button>
          )}
          {step === "approve" && !error?.stale && (
            <Button
              type="button"
              variant="project"
              isDisabled={importMutation.isPending}
              isPending={importMutation.isPending}
              onClick={runImport}
              {...vaultixActionTrigger("vaultix.ui.connect.import.apply", {
                scope: ACTION_SCOPE,
                target: provider ?? undefined
              })}
            >
              {importMutation.isPending && (
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {review?.approvalRequired ? "Open change request" : "Import"}
            </Button>
          )}
          {error?.stale && (
            <Button
              type="button"
              variant="project"
              onClick={runReview}
              isPending={reviewMutation.isPending}
            >
              Review again
            </Button>
          )}
          {step === "result" && (
            <Button type="button" variant="project" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProviderImportDialog;
