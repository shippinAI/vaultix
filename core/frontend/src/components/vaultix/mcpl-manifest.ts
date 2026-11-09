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
export type McplStatus = "ready" | "watching" | "review" | "experimental";
export type McplProvider = "doppler" | "infisical" | "vaultix" | "local-ai";
export type McplImportLifecycle = "preview" | "approve" | "import" | "complete";

export type McplImportPolicy = {
  previewRequired: boolean;
  approvalRequired: boolean;
  referenceSafe: boolean;
  syncMode: "dry-run" | "review" | "approved";
};

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

export type McplProviderRuntime = {
  id: string;
  name: string;
  provider: McplProvider;
  status: "connected" | "needs-review" | "sandbox";
  description: string;
  lastSync: string;
  projectCount: number;
  environmentCount: number;
  capabilities: readonly string[];
  lifecycle: readonly McplImportLifecycle[];
  importPolicy: McplImportPolicy;
};

export type McplRuntimeRegistry = {
  actions: readonly McplAction[];
  modules: readonly McplWorkbenchModule[];
  providers: readonly McplProviderRuntime[];
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

export const MCPL_PROVIDER_ADAPTERS: readonly McplProviderRuntime[] = [
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
] as const satisfies readonly McplProviderRuntime[];

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

export const createMcplRuntimeRegistry = ({
  actions = MCPL_ACTIONS,
  modules = DEFAULT_MCPL_MODULES,
  providers = MCPL_PROVIDER_ADAPTERS
}: Partial<McplRuntimeRegistry> = {}): McplRuntimeRegistry => ({
  actions: [...actions],
  modules: [...modules],
  providers: [...providers]
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
