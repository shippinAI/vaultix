export const guideTargets = {
  references: ["reference-app", "reference-environment", "reference-path", "reference-submit"],
  connections: ["connection-codex-subscription", "connection-configuration", "connection-access"],
  organization: ["organization-name", "organization-name-suggest", "organization-continue"],
  owner: ["admin-signup-email", "admin-signup-password", "admin-signup-create"],
  "environment-create": ["environment-name", "environment-slug", "environment-save"],
  "environment-update": ["environment-name", "environment-slug", "environment-save"]
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
    data.guides.length !== 4 ||
    (data.workflowGuides !== undefined &&
      (!Array.isArray(data.workflowGuides) || data.workflowGuides.length > 2))
  )
    throw invalid();
  const seen = new Set<string>();
  const workflows: unknown[] = Array.isArray(data.workflowGuides) ? data.workflowGuides : [];
  return [...data.guides, ...workflows].map((guide: unknown, guideIndex) => {
    if (
      !record(guide) ||
      (guide.id !== "references" &&
        guide.id !== "connections" &&
        guide.id !== "organization" &&
        guide.id !== "owner" &&
        guide.id !== "environment-create" &&
        guide.id !== "environment-update") ||
      (guideIndex < 4
        ? guide.id === "environment-create" || guide.id === "environment-update"
        : guide.id !== "environment-create" && guide.id !== "environment-update") ||
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
