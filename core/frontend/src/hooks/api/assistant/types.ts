export type TAssistantProviderKind =
  | "anthropic"
  | "bedrock"
  | "vertex"
  | "openai"
  | "openai-compatible";

export type TAssistantProvider = {
  id: string;
  kind: TAssistantProviderKind;
  name: string;
  model: string;
  // Empty means the tier runs on the standard model.
  fastModel: string;
  deepModel: string;
  baseUrl: string;
  region: string;
  cloudProject: string;
  hasCredential: boolean;
  active: boolean;
  lastTestedAt: string | null;
  lastTestOutcome: "" | "passed" | "failed";
  lastTestMessage: string;
  createdAt: string;
  updatedAt: string;
};

// Sent once and never read back. Only the fields the provider kind uses are kept.
export type TAssistantCredential = {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  serviceAccountJson?: string;
};

export type TAssistantProviderInput = {
  kind?: TAssistantProviderKind;
  name?: string;
  model?: string;
  fastModel?: string;
  deepModel?: string;
  baseUrl?: string;
  region?: string;
  cloudProject?: string;
  credential?: TAssistantCredential;
  active?: boolean;
};

export type TAssistantProviderTest = {
  outcome: "passed" | "failed";
  message: string;
  latencyMs: number;
  testedAt: string;
};

export type TAssistantModelInfo = { id: string; name: string };

export type TAssistantProviderModels = {
  models: TAssistantModelInfo[];
  listed: boolean;
  message: string;
};

export type TAssistantPersonaRole = "router" | "specialist" | "guard";
export type TAssistantPersonaTier = "fast" | "standard" | "deep";

export type TAssistantPersona = {
  slug: string;
  id: string;
  name: string;
  role: TAssistantPersonaRole;
  domains: string[];
  tier: TAssistantPersonaTier;
  // Empty means the provider's model for the tier.
  model: string;
  description: string;
  instructions: string;
  providerId: string | null;
  enabled: boolean;
  builtIn: boolean;
  customized: boolean;
  updatedAt: string | null;
};

export type TAssistantPersonaInput = {
  slug?: string;
  name?: string;
  role?: TAssistantPersonaRole;
  domains?: string[];
  tier?: TAssistantPersonaTier;
  model?: string;
  description?: string;
  instructions?: string;
  providerId?: string;
  clearProvider?: boolean;
  enabled?: boolean;
};

export type TAssistantStatus = {
  available: boolean;
  reason?: string;
  provider?: { kind: TAssistantProviderKind; model: string; name: string };
  personas: Pick<TAssistantPersona, "slug" | "name" | "role" | "description" | "domains">[];
};

export type TAssistantMessage = { role: "user" | "assistant"; content: string };

// A value-free record of what the person did (docs/0123). Never an input's value.
export type TAssistantSignal = {
  kind: "action" | "navigate";
  action?: string;
  scope?: string;
  target?: string;
  path?: string;
  at?: string;
};

export type TAssistantAction = {
  tool: string;
  domain: string;
  status: "ran" | "failed";
  error?: string;
};

// A memory the assistant suggested. Nothing is saved until the person accepts it.
export type TAssistantProposal = { content: string };

export type TAssistantReply = {
  message: TAssistantMessage;
  actions: TAssistantAction[];
  proposals: TAssistantProposal[];
  persona: { slug: string; name: string; role: TAssistantPersonaRole };
  routedBy: "mention" | "page" | "router" | "default";
  provider: { kind: TAssistantProviderKind; model: string; name: string };
};

export type TAssistantMemoryScope = "personal" | "instance";

export type TAssistantMemory = {
  id: string;
  scope: TAssistantMemoryScope;
  content: string;
  // A persona's short name, or empty for every persona.
  persona: string;
  source: "person" | "assistant";
  createdAt: string;
  updatedAt: string;
};

export type TAssistantMemoryInput = {
  scope?: TAssistantMemoryScope;
  content?: string;
  persona?: string;
  source?: "person" | "assistant";
};
