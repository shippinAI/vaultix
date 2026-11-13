import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const frontend = resolve(root, "platform/engine/frontend");
const packageRoot = resolve(frontend, "node_modules/storybook");
const { bin } = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const entry = typeof bin === "string" ? bin : bin.storybook;
const result = spawnSync(process.execPath, [resolve(packageRoot, entry), "build", "--output-dir", resolve(root, ".cache/storybook-workbench"), "--disable-telemetry"], {
  cwd: frontend, stdio: "inherit", env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: "1" }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
