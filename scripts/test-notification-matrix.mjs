// Isolated Vite component fixtures. Real API/image workflows run separately.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../core/frontend/node_modules/vite/dist/node/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/notification-proof-"));
const cases = [];
process.chdir(resolve(root, "core/frontend"));
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false, open: false },
  logLevel: "error",
});
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const variant of ["dialog", "sheet", "modal", "drawer", "alert"]) {
    for (const [width, height] of [
      [390, 500],
      [320, 500],
      [390, 320],
    ]) {
      const name = `${variant}-${width}x${height}`;
      const code = await new Promise((resolveCode, reject) => {
        const child = spawn(
          process.execPath,
          [
            resolve(root, "scripts/test-notification-ui.mjs"),
            resolve(evidence, name),
          ],
          {
            cwd: root,
            stdio: "inherit",
            env: {
              ...process.env,
              VAULTIX_UI_ORIGIN: origin,
              VAULTIX_MODAL_VARIANT: variant,
              VAULTIX_FIXTURE_WIDTH: String(width),
              VAULTIX_FIXTURE_HEIGHT: String(height),
            },
          },
        );
        child.on("error", reject);
        child.on("exit", resolveCode);
      });
      cases.push({ name, passed: code === 0 });
      writeFileSync(
        resolve(evidence, "result.json"),
        JSON.stringify({ fixtures: true, cases }, null, 2),
      );
      if (code !== 0) throw new Error(`Notification fixture failed: ${name}`);
    }
  }
  console.log(
    `Notification matrix passed: ${cases.length} cases. Evidence: ${evidence}`,
  );
} finally {
  await server.close();
}
