// Vaultix MCP warp points (docs/0120). The main MCP, POST /api/v1/vaultix/mcp, is where a client
// starts: discovery, sign-in options and the tools that predate warp points. Each domain then
// has its own MCP at /api/vx/v1/<domain>/mcp that lists and runs only that domain's tools, with
// the same handlers, permissions and audit as the UI. A planned warp point has no endpoint yet.
//
// The domain IDs are the canonical interaction domains of docs/interaction/workflows.json, in its
// order; scripts/warp-points.test.mjs keeps the two identical. This module imports nothing so
// that test can load it directly.

export const VAULTIX_DOMAINS = [
  "public",
  "auth",
  "workspace",
  "secrets",
  "access",
  "automation",
  "connect",
  "pki",
  "kms",
  "pam",
  "detect",
  "ai",
  "governance",
  "operate",
  "experience"
] as const;

export type TVaultixDomain = (typeof VAULTIX_DOMAINS)[number];

// "public" tools answer without sign-in; "signed-in" tools need a Vaultix user or machine identity
// and run with that actor's own permissions.
export type TWarpToolAccess = "public" | "signed-in";

// A view is a packaged UI that a chat client can show for a tool (MCP Apps, docs/mcp-embedded-apps.md).
// A tool names at most one view here. A client that negotiated views on the main MCP is given that
// view with the tool; every other client gets the same tool with its text result. A view is a
// screen, never authority: the tool call behind it passes the same sign-in and permission checks.
export const MCPL_VIEWS = ["references"] as const;

export type TMcplView = (typeof MCPL_VIEWS)[number];

export type TWarpTool = { name: string; access: TWarpToolAccess; view?: TMcplView };

export type TWarpPoint = {
  domain: TVaultixDomain;
  title: string;
  summary: string;
  status: "live" | "planned";
  tools: ReadonlyArray<TWarpTool>;
};

export const MAIN_MCP_PATH = "/api/v1/vaultix/mcp";
export const warpEndpoint = (domain: TVaultixDomain) => `/api/vx/v1/${domain}/mcp`;

export const WARP_POINTS: ReadonlyArray<TWarpPoint> = [
  {
    domain: "public",
    title: "Public",
    summary: "What Vaultix is and what it includes, before anyone signs in.",
    status: "live",
    tools: [{ name: "vaultix.catalog.get", access: "public" }]
  },
  {
    domain: "auth",
    title: "Sign-in",
    summary: "How an AI client signs in: machine identity, headless CLI, or the signed-in user's session.",
    status: "live",
    tools: [{ name: "vaultix.auth.options.get", access: "public" }]
  },
  {
    domain: "workspace",
    title: "Workspace",
    summary: "Organizations and the projects the signed-in actor can open.",
    status: "live",
    tools: [{ name: "vaultix.projects.list", access: "signed-in", view: "references" }]
  },
  {
    domain: "secrets",
    title: "Secrets",
    summary: "Secret names in one project, environment and folder. Never values.",
    status: "live",
    tools: [{ name: "vaultix.secrets.references", access: "signed-in", view: "references" }]
  },
  {
    domain: "access",
    title: "Access",
    summary: "Machine identities, memberships, roles and permission policy.",
    status: "planned",
    tools: []
  },
  {
    domain: "automation",
    title: "Automation",
    summary: "Rotation, scheduled jobs and approvals.",
    status: "planned",
    tools: []
  },
  {
    domain: "connect",
    title: "Connect",
    summary: "App connections and provider imports from Doppler, Infisical or another Vaultix.",
    status: "live",
    tools: [{ name: "vaultix.connect.imports.providers", access: "signed-in" }]
  },
  {
    domain: "pki",
    title: "Certificates",
    summary: "Certificate authorities, issuance and certificate lifecycle.",
    status: "planned",
    tools: []
  },
  {
    domain: "kms",
    title: "Keys",
    summary: "Key management and key use. Never key material.",
    status: "planned",
    tools: []
  },
  {
    domain: "pam",
    title: "Privileged access",
    summary: "Privileged accounts and time-bound, approved sessions.",
    status: "planned",
    tools: []
  },
  {
    domain: "detect",
    title: "Detect",
    summary: "Secret scanning, findings and remediation.",
    status: "planned",
    tools: []
  },
  {
    domain: "ai",
    title: "AI clients",
    summary: "Connecting Codex or another MCP client, and Clyffy's boundaries.",
    status: "live",
    tools: [
      { name: "vaultix.connections.get", access: "public" },
      { name: "vaultix.specialist.instructions", access: "public" }
    ]
  },
  {
    domain: "governance",
    title: "Governance",
    summary: "Audit, retention and policy evidence.",
    status: "planned",
    tools: []
  },
  {
    domain: "operate",
    title: "Operate",
    summary: "Instance health, releases, backups, upgrades and rollback.",
    status: "live",
    tools: [{ name: "vaultix.operate.updates.status", access: "signed-in" }]
  },
  {
    domain: "experience",
    title: "Guidance",
    summary: "The lessons, setup steps and teaching profile the UI uses.",
    status: "live",
    tools: [
      { name: "vaultix.guidance.get", access: "public" },
      { name: "vaultix.configure.show", access: "public" },
      { name: "vaultix.learning.profile.get", access: "public" }
    ]
  }
];

// The main MCP keeps the tools that predate warp points, so existing client configurations keep
// working, and adds discovery and sign-in options. Every new tool goes to its domain's warp point.
export const MAIN_MCP_TOOLS: ReadonlyArray<string> = [
  "vaultix.warp.list",
  "vaultix.auth.options.get",
  "vaultix.guidance.get",
  "vaultix.catalog.get",
  "vaultix.configure.show",
  "vaultix.connections.get",
  "vaultix.specialist.instructions",
  "vaultix.learning.profile.get",
  "vaultix.projects.list",
  "vaultix.secrets.references"
];

export const findWarpPoint = (domain: string) => WARP_POINTS.find((point) => point.domain === domain);

// The view a tool declares, if any. The registry above is the only place a view is attached.
export const viewForTool = (name: string): TMcplView | undefined =>
  WARP_POINTS.flatMap((point) => point.tools).find((tool) => tool.name === name)?.view;

// What vaultix.warp.list returns: summaries only. A client loads a domain's tool schemas from that
// warp point's own tools/list. Nothing here is tenant data, so it is the same for every caller.
export const listWarpPoints = () => ({
  schemaVersion: "vaultix.warp.v1",
  main: MAIN_MCP_PATH,
  howToUse:
    "Connect your MCP client to a live warp point's endpoint, on this same Vaultix host, to work in that domain. Each warp point lists only its own tools. Sign in first (see the auth warp point); signed-in tools run with your own permissions. A planned warp point has no endpoint yet. A tool with a view can show that screen in a chat client that renders MCP Apps, on the main MCP; other clients get its text result.",
  points: WARP_POINTS.map((point) => ({
    domain: point.domain,
    title: point.title,
    summary: point.summary,
    status: point.status,
    endpoint: point.status === "live" ? warpEndpoint(point.domain) : null,
    tools: point.tools.map((tool) => ({ name: tool.name, access: tool.access, view: tool.view ?? null }))
  }))
});
