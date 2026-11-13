// Save to Vaultix v1 (docs/0125, contracts/vaultix.save-secret-handoff.v1.json).
// Every protocol rule lives here so it can be tested without a browser. The value exists only
// inside one session closure; nothing returned or posted from this module carries it.

export const HANDOFF_VERSION = 1;
export const HANDOFF_KINDS = [
  "password",
  "client_secret",
  "pat",
  "recovery_password",
  "machine_key",
  "other"
] as const;
export const MAX_VALUE_BYTES = 65536;
export const MAX_SECRET_NAME = 255;

const MESSAGE_READY = "vaultix.save-secret.ready";
const MESSAGE_VALUE = "vaultix.save-secret.value";
const MESSAGE_RESULT = "vaultix.save-secret.result";
const REQUEST_PARAMS = ["v", "source", "origin", "name", "kind", "nonce"];
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,43}$/;
const SOURCE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const SAVE_FAILED = "Vaultix could not save this secret.";

export type HandoffKind = (typeof HANDOFF_KINDS)[number];
export type HandoffRequest = {
  source: string;
  origin: string;
  name: string;
  kind: HandoffKind;
  nonce: string;
};
export type HandoffProblem =
  | "feature-off"
  | "parameters"
  | "version"
  | "source"
  | "origin"
  | "nonce"
  | "kind";
export type ParsedHandoffRequest =
  | { ok: true; request: HandoffRequest }
  | { ok: false; problem: HandoffProblem };
export type ResultStatus = "fulfilled" | "approval" | "declined" | "error";
export type ResultDetails = { secretName?: string; version?: number };
export type SaveTarget = {
  projectId: string;
  environment: string;
  secretPath: string;
  secretName: string;
};
export type CreateSecretRequest = {
  path: string;
  body: {
    projectId: string;
    environment: string;
    secretPath: string;
    secretValue: string;
    type: "shared";
    secretComment: string;
  };
};
export type OpenerLike = { postMessage: (message: unknown, targetOrigin: string) => void };
export type MessageEventLike = { origin: string; source: unknown; data: unknown };
export type HandoffPhase = "idle" | "no-opener" | "waiting" | "received" | "saving" | "done";
export type HandoffSnapshot = {
  phase: HandoffPhase;
  valueLength: number;
  failedMessage?: string;
  result?: { status: ResultStatus } & ResultDetails;
};

const SOURCE_NAMES: Record<string, string> = { nomen: "Nomen" };
const KIND_LABELS: Record<HandoffKind, string> = {
  password: "password",
  client_secret: "client secret",
  pat: "personal access token",
  recovery_password: "recovery password",
  machine_key: "machine key",
  other: "other"
};

export const sourceName = (source: string) => SOURCE_NAMES[source] ?? source;
export const kindLabel = (kind: HandoffKind) => KIND_LABELS[kind];

const isKind = (value: string | null): value is HandoffKind =>
  HANDOFF_KINDS.some((kind) => kind === value);

// SecretNameSchema: trimmed, non-empty, no colon or forward slash. A suggestion only.
export const suggestSecretName = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/[\s:/]+/g, "_")
    .slice(0, MAX_SECRET_NAME);
};

export const isValidSecretName = (name: string) =>
  name.trim().length > 0 &&
  name.length <= MAX_SECRET_NAME &&
  name === name.trim() &&
  !name.includes(":") &&
  !name.includes("/");

export const isValidSecretPath = (path: string) =>
  path.startsWith("/") && !path.includes("//") && !path.includes("\\") && path.length <= 1024;

export const parseHandoffRequest = (
  search: string,
  allowedOrigins: readonly string[]
): ParsedHandoffRequest => {
  if (allowedOrigins.length === 0) return { ok: false, problem: "feature-off" };
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (keys.some((key) => !REQUEST_PARAMS.includes(key)) || new Set(keys).size !== keys.length) {
    return { ok: false, problem: "parameters" };
  }
  if (params.get("v") !== String(HANDOFF_VERSION)) return { ok: false, problem: "version" };
  const source = params.get("source");
  if (!source || !SOURCE_PATTERN.test(source)) return { ok: false, problem: "source" };
  const origin = params.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) return { ok: false, problem: "origin" };
  const nonce = params.get("nonce");
  if (!nonce || !NONCE_PATTERN.test(nonce)) return { ok: false, problem: "nonce" };
  const kind = params.get("kind");
  if (!isKind(kind)) return { ok: false, problem: "kind" };
  return {
    ok: true,
    request: { source, origin, name: suggestSecretName(params.get("name")), kind, nonce }
  };
};

export const readyMessage = (nonce: string) => ({
  type: MESSAGE_READY,
  v: HANDOFF_VERSION,
  nonce
});

export const resultMessage = (
  nonce: string,
  status: ResultStatus,
  details: ResultDetails = {}
) => ({
  type: MESSAGE_RESULT,
  v: HANDOFF_VERSION,
  nonce,
  status,
  ...((status === "fulfilled" || status === "approval") && details.secretName
    ? { secretName: details.secretName }
    : {}),
  ...(status === "fulfilled" && typeof details.version === "number"
    ? { version: details.version }
    : {})
});

const byteLength = (value: string) => new TextEncoder().encode(value).length;

export const readValueMessage = (
  event: MessageEventLike,
  expected: { origin: string; source: unknown; nonce: string }
): string | null => {
  if (event.origin !== expected.origin || !event.source || event.source !== expected.source) {
    return null;
  }
  const { data } = event;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  const keys = Object.keys(message);
  if (
    keys.length !== 4 ||
    !["type", "v", "nonce", "value"].every((key) => keys.includes(key)) ||
    message.type !== MESSAGE_VALUE ||
    message.v !== HANDOFF_VERSION ||
    message.nonce !== expected.nonce ||
    typeof message.value !== "string" ||
    message.value.length === 0 ||
    byteLength(message.value) > MAX_VALUE_BYTES
  ) {
    return null;
  }
  return message.value;
};

export const createSecretRequest = (
  target: SaveTarget,
  value: string,
  request: Pick<HandoffRequest, "source" | "kind">
): CreateSecretRequest => ({
  path: `/api/v4/secrets/${encodeURIComponent(target.secretName)}`,
  body: {
    projectId: target.projectId,
    environment: target.environment,
    secretPath: target.secretPath,
    secretValue: value,
    type: "shared",
    secretComment: `Saved from ${sourceName(request.source)} (${kindLabel(request.kind)})`
  }
});

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const classifyCreateResponse = (
  response: unknown,
  secretName: string
): ({ status: "fulfilled" | "approval" } & ResultDetails) | undefined => {
  const data = record(response);
  const secret = record(data?.secret);
  if (secret && typeof secret.version === "number") {
    return {
      status: "fulfilled",
      secretName: typeof secret.secretKey === "string" ? secret.secretKey : secretName,
      version: secret.version
    };
  }
  if (record(data?.approval)) return { status: "approval", secretName };
  return undefined;
};

const failureMessage = (error: unknown, value: string) => {
  const message = record(record(record(error)?.response)?.data)?.message;
  if (typeof message !== "string" || message.length === 0 || message.length > 300) {
    return SAVE_FAILED;
  }
  return message.includes(value) ? SAVE_FAILED : message;
};

export const createHandoffSession = ({
  opener,
  request,
  createSecret,
  onChange
}: {
  opener: OpenerLike | null;
  request: HandoffRequest;
  createSecret: (input: CreateSecretRequest) => Promise<unknown>;
  onChange?: (snapshot: HandoffSnapshot) => void;
}) => {
  let phase: HandoffPhase = "idle";
  let value = "";
  let failedMessage: string | undefined;
  let failedAttempt = false;
  let readyPosted = false;
  let result: HandoffSnapshot["result"];

  const snapshot = (): HandoffSnapshot => ({
    phase,
    valueLength: value.length,
    ...(failedMessage ? { failedMessage } : {}),
    ...(result ? { result: { ...result } } : {})
  });
  const changed = () => onChange?.(snapshot());
  const finish = (status: ResultStatus, details: ResultDetails = {}) => {
    if (phase === "done" || !readyPosted || !opener) return;
    value = "";
    phase = "done";
    result = { status, ...(status === "fulfilled" || status === "approval" ? details : {}) };
    failedMessage = undefined;
    opener.postMessage(resultMessage(request.nonce, status, details), request.origin);
    changed();
  };

  return {
    snapshot,
    start: () => {
      if (phase !== "idle") return false;
      if (!opener) {
        phase = "no-opener";
        changed();
        return false;
      }
      phase = "waiting";
      readyPosted = true;
      opener.postMessage(readyMessage(request.nonce), request.origin);
      changed();
      return true;
    },
    receive: (event: MessageEventLike) => {
      if (phase !== "waiting") return false;
      const received = readValueMessage(event, {
        origin: request.origin,
        source: opener,
        nonce: request.nonce
      });
      if (received === null) return false;
      value = received;
      phase = "received";
      changed();
      return true;
    },
    save: async (target: SaveTarget) => {
      if (phase !== "received") return snapshot();
      phase = "saving";
      failedMessage = undefined;
      changed();
      try {
        const outcome = classifyCreateResponse(
          await createSecret(createSecretRequest(target, value, request)),
          target.secretName
        );
        if (outcome) {
          finish(outcome.status, outcome);
          return snapshot();
        }
        failedMessage = SAVE_FAILED;
      } catch (error) {
        failedMessage = failureMessage(error, value);
      }
      failedAttempt = true;
      phase = "received";
      changed();
      return snapshot();
    },
    cancel: () => {
      if (phase === "saving") return;
      if (!readyPosted) {
        value = "";
        return;
      }
      finish(failedAttempt ? "error" : "declined");
    },
    pageHidden: () => {
      if (readyPosted) finish(failedAttempt ? "error" : "declined");
      value = "";
    }
  };
};

export type HandoffSession = ReturnType<typeof createHandoffSession>;

export type RememberedChoice = {
  organizationId: string;
  projectId: string;
  environment: string;
  secretPath: string;
};

export const rememberedChoiceKey = (userId: string) => `vaultix.save-secret.choice.v1.${userId}`;

export const serializeRememberedChoice = (choice: RememberedChoice) =>
  JSON.stringify({
    organizationId: choice.organizationId,
    projectId: choice.projectId,
    environment: choice.environment,
    secretPath: choice.secretPath
  });

export const readRememberedChoice = (raw: string | null): RememberedChoice | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const choice = record(parsed);
  if (!choice) return null;
  const { organizationId, projectId, environment, secretPath } = choice;
  if (
    typeof organizationId !== "string" ||
    typeof projectId !== "string" ||
    typeof environment !== "string" ||
    typeof secretPath !== "string" ||
    !isValidSecretPath(secretPath)
  ) {
    return null;
  }
  return { organizationId, projectId, environment, secretPath };
};
