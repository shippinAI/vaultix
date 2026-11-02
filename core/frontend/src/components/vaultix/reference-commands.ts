export const referenceCommandCatalog = [
  { id: "reference.project", target: "reference-app", effect: "local" },
  { id: "reference.environment", target: "reference-environment", effect: "local" },
  { id: "reference.folder", target: "reference-path", effect: "local" },
  {
    id: "reference.load",
    target: "reference-submit",
    effect: "read",
    source: "vaultix.secrets.references"
  },
  { id: "reference.reset", target: "reference-app", effect: "local" }
] as const;

export type ReferenceCommand = {
  version: 1;
  scope: string;
  action: (typeof referenceCommandCatalog)[number]["id"];
  value?: string;
};

export const readReferenceCommand = (input: unknown, scope: string): ReferenceCommand | null => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const command = input as Record<string, unknown>;
  const needsValue = ["reference.project", "reference.environment", "reference.folder"].includes(
    String(command.action)
  );
  if (
    command.version !== 1 ||
    command.scope !== scope ||
    !referenceCommandCatalog.some((entry) => entry.id === command.action) ||
    Object.keys(command).some(
      (key) => !["version", "scope", "action", ...(needsValue ? ["value"] : [])].includes(key)
    ) ||
    (needsValue &&
      (typeof command.value !== "string" ||
        command.value.length === 0 ||
        command.value.length > 1024)) ||
    (command.action === "reference.folder" && !String(command.value).startsWith("/"))
  )
    return null;
  return command as ReferenceCommand;
};

export type ReferenceControls = {
  execute: (command: unknown) => boolean;
  snapshot: () => {
    ready: boolean;
    loading: boolean;
    completed: boolean;
    failed: boolean;
    firstProject?: { id: string; environment: string };
  };
};
