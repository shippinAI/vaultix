import type { TImportProviderId, TImportProviderRuntime } from "@app/hooks/api/migration/types";

export type McplDomain =
  | "public"
  | "auth"
  | "identity"
  | "workspace"
  | "secrets"
  | "policy"
  | "connect"
  | "ai"
  | "operate";

export type McplSurface = "public" | "auth" | "tenant";
export type McplStatus =
  | "ready"
  | "watching"
  | "review"
  | "experimental"
  | "needs-connection"
  | "unavailable";
export type McplProvider = TImportProviderId | "local-ai";

export type McplAction = {
  id: string;
  domain: McplDomain;
  title: string;
  description: string;
  surface: McplSurface;
  status: McplStatus;
  owner: "Vaultix" | "Clyffy" | "Admin";
  provider?: McplProvider;
  tags: readonly string[];
  actionLabel: string;
};

export type McplWorkbenchModule = {
  id: McplDomain;
  label: string;
  enabled: boolean;
  description: string;
};

// Static descriptions of each import provider. Counts, connections and status are runtime
// state from GET /api/vx/v1/connect/imports/providers, never written here.
export type ImportProviderDetails = {
  id: TImportProviderId;
  name: string;
  image: string;
  summary: string;
  worksWith: string;
  sourceShape: string;
  projectLabel: string;
  environmentLabel: string;
  capabilities: ReadonlyArray<{ label: string; help: string }>;
  actionId: string;
};

export const IMPORT_PROVIDER_DETAILS: Record<TImportProviderId, ImportProviderDetails> = {
  doppler: {
    id: "doppler",
    name: "Doppler",
    image: "/images/integrations/Doppler.png",
    summary: "Bring a Doppler config into a Vaultix folder.",
    worksWith: "Doppler workspaces through a service or personal API token.",
    sourceShape: "Project → config",
    projectLabel: "Doppler project",
    environmentLabel: "Doppler config",
    capabilities: [
      { label: "Configs and branches", help: "Pick any root or branch config in a project." },
      {
        label: "Name-only review",
        help: "You review secret names before anything is written. Values never reach your browser."
      },
      {
        label: "Approval policies",
        help: "If the destination folder has an approval policy, the import becomes a change request."
      }
    ],
    actionId: "vaultix.ui.connect.doppler.import"
  },
  "external-vaultix": {
    id: "external-vaultix",
    name: "Infisical",
    // A neutral instance mark; no third-party logo ships for this provider.
    image: "/images/integrations/VaultixInstance.svg",
    summary: "Bring an Infisical folder into a Vaultix folder.",
    worksWith:
      "Infisical Cloud, self-hosted Infisical, or another Vaultix instance, with a machine identity.",
    sourceShape: "Project → environment → folder",
    projectLabel: "Source project",
    environmentLabel: "Source environment",
    capabilities: [
      {
        label: "Any folder",
        help: "Import one folder at a time from any environment you can read."
      },
      {
        label: "Name-only review",
        help: "You review secret names before anything is written. Values never reach your browser."
      },
      {
        label: "Unreadable values refused",
        help: "If the machine identity can't read a value, that secret is shown as unreadable and never imported."
      },
      {
        label: "Approval policies",
        help: "If the destination folder has an approval policy, the import becomes a change request."
      }
    ],
    actionId: "vaultix.ui.connect.external-vaultix.import"
  }
};

export const IMPORT_PROVIDER_ORDER: readonly TImportProviderId[] = ["doppler", "external-vaultix"];

export const IMPORT_LIFECYCLE_HELP: Record<"review" | "approve" | "import", string> = {
  review:
    "Vaultix reads the source on the server and shows which secret names are new, already exist or can't be imported.",
  approve: "You choose exactly which names to bring over. Nothing is written until you confirm.",
  import:
    "Vaultix writes only the names you approved, or opens a change request if the folder has an approval policy."
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
    id: "vaultix.ui.identity.session.policy",
    domain: "identity",
    title: "Identity and session policy",
    description:
      "Review SSO, membership and session provenance evidence before a tenant is allowed to request provider imports.",
    surface: "auth",
    status: "ready",
    owner: "Vaultix",
    tags: ["identity", "sso", "policy"],
    actionLabel: "Review policy"
  },
  {
    id: "vaultix.ui.connect.doppler.import",
    domain: "connect",
    title: "Import from Doppler",
    description:
      "Review names from a Doppler config, approve the selection, then import or open a change request.",
    surface: "tenant",
    status: "watching",
    owner: "Clyffy",
    provider: "doppler",
    tags: ["import", "doppler", "connect"],
    actionLabel: "Open connections"
  },
  {
    id: "vaultix.ui.connect.external-vaultix.import",
    domain: "connect",
    title: "Import from Infisical",
    description:
      "Review names from an Infisical or Vaultix folder, approve the selection, then import or open a change request.",
    surface: "tenant",
    status: "watching",
    owner: "Clyffy",
    provider: "external-vaultix",
    tags: ["import", "infisical", "connect"],
    actionLabel: "Open connections"
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
    id: "vaultix.ui.policy.enterprise.guardrails",
    domain: "policy",
    title: "Enterprise policy guardrails",
    description:
      "Apply tenancy boundaries, approval routing and security policy before an AI or operator can import secrets.",
    surface: "tenant",
    status: "review",
    owner: "Admin",
    tags: ["policy", "guardrails", "enterprise"],
    actionLabel: "Open policy"
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

export const DEFAULT_MCPL_MODULES: readonly McplWorkbenchModule[] = [
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
    id: "identity",
    label: "Identity policy",
    enabled: true,
    description: "Session provenance and enterprise identity gates"
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
    id: "policy",
    label: "Enterprise policy",
    enabled: true,
    description: "Approval routing and security guardrails"
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
] as const satisfies readonly McplWorkbenchModule[];

// Provider actions take their status from the server's provider runtime: ready with a usable
// connection, needs-connection without one, unavailable when the actor may not use connections.
// Without runtime (still loading) the manifest status stands.
export const resolveMcplActions = (
  actions: readonly McplAction[],
  providers?: readonly TImportProviderRuntime[]
): McplAction[] =>
  actions.map((action) => {
    const runtime = providers?.find((provider) => provider.provider === action.provider);
    if (!runtime) return action;
    let status: McplStatus = "ready";
    if (runtime.unavailableReason) status = "unavailable";
    else if (!runtime.connections.length) status = "needs-connection";
    return { ...action, status };
  });

export const MCPL_DOMAIN_ORDER: readonly McplDomain[] = [
  "public",
  "auth",
  "identity",
  "connect",
  "secrets",
  "policy",
  "ai",
  "operate",
  "workspace"
];
