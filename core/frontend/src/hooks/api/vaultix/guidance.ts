import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

export const guideTargets = {
  references: ["reference-app", "reference-environment", "reference-path", "reference-submit"],
  connections: ["connection-codex-subscription", "connection-configuration", "connection-access"],
  organization: ["organization-name", "organization-name-suggest", "organization-continue"],
  owner: ["admin-signup-email", "admin-signup-password", "admin-signup-create"]
} as const;
export type GuideId = keyof typeof guideTargets;
export type GuideStep = {
  id: string;
  component: "configure-step";
  target: string;
  title: string;
  hint: string;
  body: string;
  teaches: string;
};
export type VaultixGuide = { id: GuideId; title: string; summary: string; steps: GuideStep[] };
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1500;
const invalid = () =>
  new Error("This Vaultix guide is unsupported. Update the app and server together.");

export const readGuidance = (data: unknown): VaultixGuide[] => {
  if (
    !record(data) ||
    data.schemaVersion !== "vaultix.guidance.v1" ||
    data.source !== "catalog" ||
    data.a2uiVersion !== "0.9.1" ||
    !Array.isArray(data.guides) ||
    data.guides.length !== Object.keys(guideTargets).length
  )
    throw invalid();
  const seen = new Set<string>();
  return data.guides.map((guide: unknown) => {
    if (
      !record(guide) ||
      (guide.id !== "references" &&
        guide.id !== "connections" &&
        guide.id !== "organization" &&
        guide.id !== "owner") ||
      seen.has(guide.id) ||
      !text(guide.title) ||
      !text(guide.summary) ||
      !Array.isArray(guide.steps)
    )
      throw invalid();
    seen.add(guide.id);
    const targets: readonly string[] = guideTargets[guide.id];
    if (guide.steps.length !== targets.length) throw invalid();
    const stepIds = new Set<string>();
    const steps = guide.steps.map((step: unknown, index: number): GuideStep => {
      if (
        !record(step) ||
        !text(step.id) ||
        !/^[a-z-]{1,40}$/.test(step.id) ||
        stepIds.has(step.id) ||
        step.component !== "configure-step" ||
        step.target !== targets[index] ||
        !text(step.title) ||
        !text(step.hint) ||
        !text(step.body) ||
        !text(step.teaches)
      )
        throw invalid();
      stepIds.add(step.id);
      return {
        id: step.id,
        component: "configure-step",
        target: targets[index],
        title: step.title,
        hint: step.hint,
        body: step.body,
        teaches: step.teaches
      };
    });
    return { id: guide.id, title: guide.title, summary: guide.summary, steps };
  });
};

export const useVaultixGuidance = () =>
  useQuery({
    queryKey: ["vaultix", "guidance"],
    queryFn: async () =>
      readGuidance((await apiRequest.get<unknown>("/api/v1/vaultix/guidance")).data)
  });
