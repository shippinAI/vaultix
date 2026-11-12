import { spawn } from "node:child_process";
import path from "node:path";

export type GatewayTransportRequest = {
  version: 1;
  mode: "ping" | "proxy";
  host: string;
  serverName?: string;
  port: number;
  ca: string;
  cert: string;
  key: string;
  identityId: string;
  orgId: string;
  command?: string;
};

export const startGatewayTransport = async (
  request: GatewayTransportRequest,
  executable = path.resolve(process.cwd(), process.platform === "win32" ? "vaultix-transport.exe" : "vaultix-transport")
): Promise<{ port: number; cleanup: () => Promise<void>; getError: () => string }> => {
  const payload = `${JSON.stringify(request)}\n`;
  if (Buffer.byteLength(payload) >= 1024 * 1024) throw new Error("Gateway transport configuration is too large.");
  const worker = spawn(executable, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  let lastError = "";
  let exited = false;
  const stopped = new Promise<void>((resolve) => {
    worker.once("close", () => {
      exited = true;
      resolve();
    });
  });
  const cleanup = async () => {
    if (exited) return;
    worker.stdin.end();
    const timer = setTimeout(() => worker.kill("SIGKILL"), 2_000);
    timer.unref();
    try {
      await stopped;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Vaultix gateway transport did not become ready.")), 35_000);
      const fail = (error: Error) => {
        clearTimeout(timeout);
        lastError = error.message;
        reject(error);
      };
      let pending = "";
      worker.once("error", () =>
        fail(new Error("Vaultix gateway transport could not start. Rebuild the application image."))
      );
      worker.stdin.on("error", () => fail(new Error("Vaultix gateway transport input closed.")));
      worker.once("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && !lastError) lastError = "Vaultix gateway transport exited unexpectedly.";
        reject(new Error(lastError || "Vaultix gateway transport closed before becoming ready."));
      });
      worker.stdout.setEncoding("utf8");
      worker.stdout.on("data", (chunk: string) => {
        pending += chunk;
        if (pending.length > 64 * 1024) {
          fail(new Error("Invalid gateway transport response."));
          worker.kill();
          return;
        }
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const status: unknown = JSON.parse(line);
            if (!status || typeof status !== "object" || !("version" in status) || status.version !== 1) {
              throw new Error("Invalid gateway transport response version.");
            }
            if ("error" in status && typeof status.error === "string" && status.error) {
              fail(new Error(status.error.slice(0, 512)));
            } else if (request.mode === "ping" && "ok" in status && status.ok === true) {
              clearTimeout(timeout);
              resolve(0);
            } else if (
              request.mode === "proxy" &&
              "ready" in status &&
              status.ready === true &&
              "port" in status &&
              typeof status.port === "number" &&
              Number.isInteger(status.port) &&
              status.port > 0 &&
              status.port <= 65535
            ) {
              clearTimeout(timeout);
              resolve(status.port);
            } else throw new Error("Invalid gateway transport status.");
          } catch (error) {
            fail(error instanceof Error ? error : new Error("Invalid gateway transport response."));
            worker.kill();
          }
          newline = pending.indexOf("\n");
        }
      });
      worker.stdin.write(payload);
    });
    return { port, cleanup, getError: () => lastError };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
