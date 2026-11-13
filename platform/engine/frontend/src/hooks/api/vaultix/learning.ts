export type VaultixTeachingSignal = {
  id: string;
  kind: "did-you-know" | "knowledge-drop";
  title: string;
  description: string;
  context: ("references" | "connections")[];
  source: "catalog";
};

export type VaultixCapabilityFamily = {
  id: string;
  title: string;
  summary: string;
  featurePolicy: "included";
  reviewStatus: "in-progress";
  category: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const identifier = (value: unknown): value is string =>
  text(value, 80) && /^[a-z][a-z0-9-]*$/.test(value);

const isSignal = (value: unknown): value is VaultixTeachingSignal =>
  isRecord(value) &&
  identifier(value.id) &&
  text(value.title, 160) &&
  text(value.description, 1000) &&
  value.source === "catalog" &&
  (value.kind === "did-you-know" || value.kind === "knowledge-drop") &&
  Array.isArray(value.context) &&
  value.context.length > 0 &&
  value.context.length <= 2 &&
  new Set(value.context).size === value.context.length &&
  value.context.every((area) => area === "references" || area === "connections");

const isFamily = (value: unknown): value is VaultixCapabilityFamily =>
  isRecord(value) &&
  identifier(value.id) &&
  text(value.title, 160) &&
  text(value.summary, 1000) &&
  text(value.category, 80) &&
  value.featurePolicy === "included" &&
  value.reviewStatus === "in-progress";

const readList = <T extends { id: string }>(
  value: unknown,
  check: (entry: unknown) => entry is T
): T[] => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 12 ||
    !value.every(check) ||
    new Set(value.map((entry) => entry.id)).size !== value.length
  ) {
    throw new Error("This learning content is not supported. Update the app and server together.");
  }
  return value;
};

export const readVaultixLearning = (catalog: Record<string, unknown>) => {
  const didYouKnow = readList(catalog.didYouKnow, isSignal);
  const knowledgeDrops = readList(catalog.knowledgeDrops, isSignal);
  if (
    didYouKnow.some((signal) => signal.kind !== "did-you-know") ||
    knowledgeDrops.some((signal) => signal.kind !== "knowledge-drop") ||
    new Set([...didYouKnow, ...knowledgeDrops].map((signal) => signal.id)).size !==
      didYouKnow.length + knowledgeDrops.length
  ) {
    throw new Error("This learning content is not supported. Update the app and server together.");
  }
  return {
    didYouKnow,
    knowledgeDrops,
    enterpriseCapabilities: readList(catalog.enterpriseCapabilities, isFamily)
  };
};

export const selectVaultixLearning = (
  signals: VaultixTeachingSignal[],
  area: "references" | "connections"
) => signals.filter((signal) => signal.context.includes(area));
