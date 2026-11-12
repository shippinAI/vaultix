import type { ReferenceScope } from "@app/hooks/api/vaultix/reference-contract";
import { readToolData } from "@app/hooks/api/vaultix/reference-contract";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const supportedTools = new Set([
  "vaultix.projects.list",
  "vaultix.secrets.references",
  "vaultix.guidance.get",
  "vaultix.catalog.get",
  "vaultix.configure.show"
]);
const failure = () =>
  new Error("The Vaultix connection is unavailable. Reconnect Vaultix in your AI client.");
type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class VaultixAppBridge {
  private pending = new Map<string, Pending>();
  private closed = false;
  private ready = false;
  private origin = "*";
  private generation = crypto.randomUUID();
  private sequence = 0;
  private onDisconnect: () => void;
  private onToolResult: (result: unknown) => void;
  private onToolInput: (scope?: ReferenceScope) => void;
  private receivedInput = false;
  private inputTimer?: ReturnType<typeof setTimeout>;

  constructor(callbacks: {
    onDisconnect: () => void;
    onToolResult: (result: unknown) => void;
    onToolInput: (scope?: ReferenceScope) => void;
  }) {
    this.onDisconnect = callbacks.onDisconnect;
    this.onToolResult = callbacks.onToolResult;
    this.onToolInput = callbacks.onToolInput;
    window.addEventListener("message", this.receive);
  }

  private post(message: unknown) {
    if (window.parent === window || this.closed) throw failure();
    window.parent.postMessage(message, this.origin === "null" ? "*" : this.origin);
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed || this.pending.size >= 8) return Promise.reject(failure());
    const id = `${this.generation}:${this.sequence}`;
    this.sequence += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(failure());
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.post({ jsonrpc: "2.0", id, method, params });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(failure());
      }
    });
  }

  private receive = (event: MessageEvent<unknown>) => {
    if (
      this.closed ||
      event.source !== window.parent ||
      (this.origin !== "*" && event.origin !== this.origin)
    )
      return;
    const body = event.data;
    if (!record(body) || body.jsonrpc !== "2.0") return;
    try {
      if (JSON.stringify(body).length > 8 * 1024 * 1024) return;
    } catch {
      return;
    }
    if (typeof body.id === "string" && this.pending.has(body.id) && body.method === undefined) {
      const pending = this.pending.get(body.id)!;
      this.pending.delete(body.id);
      clearTimeout(pending.timer);
      if (!record(body.result) || body.error !== undefined) pending.reject(failure());
      else {
        this.origin = event.origin;
        pending.resolve(body.result);
      }
      return;
    }
    if (!this.ready) return;
    if (
      body.id === undefined &&
      body.method === "ui/notifications/tool-input" &&
      !this.receivedInput
    ) {
      this.receivedInput = true;
      clearTimeout(this.inputTimer);
      const args = record(body.params) ? body.params.arguments : undefined;
      if (!record(args)) {
        this.close();
        return;
      }
      if (Object.keys(args).length === 0) {
        this.onToolInput();
        return;
      }
      const { projectId, environment, secretPath = "/", offset = 0, limit = 50 } = args;
      if (
        Object.keys(args).some(
          (key) => !["projectId", "environment", "secretPath", "offset", "limit"].includes(key)
        ) ||
        typeof projectId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(projectId) ||
        typeof environment !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(environment) ||
        typeof secretPath !== "string" ||
        secretPath.length > 1024 ||
        !secretPath.startsWith("/") ||
        [...secretPath].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\"
        ) ||
        secretPath.split("/").some((part) => part === "." || part === "..") ||
        !Number.isSafeInteger(offset) ||
        Number(offset) < 0 ||
        Number(offset) > 1000000 ||
        !Number.isSafeInteger(limit) ||
        Number(limit) < 1 ||
        Number(limit) > 100
      ) {
        this.close();
        return;
      }
      this.onToolInput({ projectId, environment, secretPath, offset: 0 });
      return;
    }
    if (body.id === undefined && body.method === "ui/notifications/host-context-changed") {
      VaultixAppBridge.applyHostContext(body.params);
      return;
    }
    if (
      body.method === "ui/resource-teardown" &&
      ((typeof body.id === "string" && body.id.length <= 128) ||
        (typeof body.id === "number" && Number.isSafeInteger(body.id)))
    ) {
      this.post({ jsonrpc: "2.0", id: body.id, result: {} });
      this.close();
    } else if (
      body.id === undefined &&
      body.method === "ui/notifications/tool-result" &&
      record(body.params)
    ) {
      this.onToolResult(body.params);
    } else if (body.id === undefined && body.method === "ui/notifications/tool-cancelled") {
      this.close();
    } else if (
      body.method === "ping" &&
      ((typeof body.id === "string" && body.id.length <= 128) ||
        (typeof body.id === "number" && Number.isSafeInteger(body.id)))
    ) {
      this.post({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  };

  async connect() {
    if (this.closed || this.ready) throw failure();
    const result = await this.request("ui/initialize", {
      protocolVersion: "2026-01-26",
      appInfo: { name: "vaultix-references", version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline"] }
    });
    if (
      !record(result) ||
      result.protocolVersion !== "2026-01-26" ||
      !record(result.hostCapabilities) ||
      !record(result.hostCapabilities.serverTools)
    ) {
      this.close();
      throw failure();
    }
    if (this.closed) throw failure();
    this.ready = true;
    VaultixAppBridge.applyHostContext(result.hostContext);
    this.inputTimer = setTimeout(() => {
      if (!this.receivedInput) this.close();
    }, 15000);
    this.post({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  }

  private static applyHostContext(value: unknown) {
    if (!record(value)) return;
    // Use bounded layout hints only. Never inject host CSS, fonts, URLs or HTML.
    if (record(value.containerDimensions)) {
      const { maxHeight } = value.containerDimensions;
      if (
        typeof maxHeight === "number" &&
        Number.isFinite(maxHeight) &&
        maxHeight >= 100 &&
        maxHeight <= 4000
      )
        document.documentElement.style.setProperty(
          "--host-max-height",
          `${Math.floor(maxHeight)}px`
        );
    }
  }

  async call(name: string, args: Record<string, unknown>) {
    if (!this.ready || this.closed || !supportedTools.has(name)) throw failure();
    if (JSON.stringify(args).length > 8192) throw failure();
    const result = await this.request("tools/call", { name, arguments: args });
    if (this.closed) throw failure();
    return readToolData({ result });
  }

  size(height: number) {
    if (!this.ready || this.closed || !Number.isFinite(height)) return;
    this.post({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { height: Math.min(2000, Math.max(100, Math.ceil(height))) }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.inputTimer);
    this.ready = false;
    window.removeEventListener("message", this.receive);
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(failure());
    });
    this.pending.clear();
    document.documentElement.style.removeProperty("--host-max-height");
    this.onDisconnect();
  }
}
