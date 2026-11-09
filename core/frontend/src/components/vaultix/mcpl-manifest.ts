export type McplDomain =
  | "public"
  | "auth"
  | "workspace"
  | "secrets"
  | "connect"
  | "ai"
  | "operate";

export type McplSurface = "public" | "auth" | "tenant";
export type McplStatus = "ready" | "watching" | "review" | "experimental";

export type McplAction = {
  id: string;
  domain: McplDomain;
  title: string;
  description: string;
  surface: McplSurface;
  status: McplStatus;
  owner: "Vaultix" | "Clyffy" | "Admin";
  provider?: "doppler" | "infisical" | "vaultix" | "local-ai";
  tags: readonly string[];
  actionLabel: string;
};

export const MCPL_ACTIONS = [
  {
    id: "vaultix.ui.public.help.rehearsal",
    domain: "public",
    title: "Public onboarding guided rehearsal",
    description:
      "Present the product walkthrough and surface the scripted introduction without changing tenant state.",
    surface: "public",
    status: "ready",
    owner: "Vaultix",
    tags: ["onboarding", "public", "help"],
    actionLabel: "Open rehearsal"
  },
  {
    id: "vaultix.ui.auth.keys.manage",
    domain: "auth",
    title: "Manage provider keys",
    description:
      "Review provider credentials, scopes, and enablement state from the admin boundary while keeping values out of chat.",
    surface: "auth",
    status: "ready",
    owner: "Admin",
    tags: ["keys", "admin", "security"],
    actionLabel: "Open admin"
  },
  {
    id: "vaultix.ui.connect.doppler.import",
    domain: "connect",
    title: "Import from Doppler",
    description:
      "Dry-run a project import, map Vaultix workspaces and environments, then apply only after approval.",
    surface: "tenant",
    status: "watching",
    owner: "Clyffy",
    provider: "doppler",
    tags: ["import", "doppler", "connect"],
    actionLabel: "Import project"
  },
  {
    id: "vaultix.ui.connect.infisical.import",
    domain: "connect",
    title: "Import from Infisical",
    description:
      "Mirror the same importer contract for Infisical and preserve a reviewable receipt for each environment.",
    surface: "tenant",
    status: "watching",
    owner: "Clyffy",
    provider: "infisical",
    tags: ["import", "infisical", "connect"],
    actionLabel: "Import project"
  },
  {
    id: "vaultix.ui.secrets.reference.load",
    domain: "secrets",
    title: "Load reference map",
    description:
      "Select project, environment, folder and load secret references without exposing raw values in the event stream.",
    surface: "tenant",
    status: "ready",
    owner: "Vaultix",
    tags: ["secrets", "reference", "workspace"],
    actionLabel: "Load names"
  },
  {
    id: "vaultix.ui.ai.local.sandbox",
    domain: "ai",
    title: "Run local model sandbox",
    description:
      "Keep sensitive inputs inside a controlled local sandbox and evaluate the smallest model first before escalating.",
    surface: "tenant",
    status: "experimental",
    owner: "Clyffy",
    provider: "local-ai",
    tags: ["ai", "sandbox", "local"],
    actionLabel: "Launch sandbox"
  },
  {
    id: "vaultix.ui.operate.audits.review",
    domain: "operate",
    title: "Review action receipts",
    description:
      "Validate approvals, retries, provider access and environment changes with a clear event receipt model.",
    surface: "tenant",
    status: "review",
    owner: "Vaultix",
    tags: ["audit", "receipts", "operations"],
    actionLabel: "Open audit"
  }
] as const satisfies readonly McplAction[];

export const MCPL_DOMAIN_ORDER: readonly McplDomain[] = [
  "public",
  "auth",
  "connect",
  "secrets",
  "ai",
  "operate",
  "workspace"
];
