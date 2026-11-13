// Save to Vaultix (docs/0125): backend unit suites, or with --lint ESLint over the touched files,
// each run from its own package so the package's configuration applies.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = resolve(root, "platform/engine/backend");
const frontend = resolve(root, "platform/engine/frontend");
const run = (cwd, args) => {
  const result = spawnSync(process.execPath, ["--max-old-space-size=8192", ...args], { cwd, stdio: "inherit" });
  if (result.status !== 0 || result.error) process.exit(result.status || 1);
};

if (process.argv[2] === "--lint") {
  run(frontend, ["node_modules/eslint/bin/eslint.js", "--max-warnings", "0",
    "src/pages/integrations",
    "src/helpers/return-path.ts",
    "src/helpers/sessionStorage.ts",
    "src/pages/auth/SelectOrgPage/SelectOrgPage.tsx",
    "src/hooks/api/admin/types.ts"]);
  run(backend, ["node_modules/eslint/bin/eslint.js", "--max-warnings", "0",
    "src/lib/config/integration-origins.ts",
    "src/lib/config/integration-origins.test.ts",
    "src/lib/config/env.ts",
    "src/server/plugins/serve-ui.ts",
    "src/server/plugins/serve-ui-headers.ts",
    "src/server/plugins/serve-ui-headers.test.ts",
    "src/server/routes/v1/admin-router.ts"]);
  console.log("Save to Vaultix: lint passed for the touched files.");
} else {
  run(backend, ["node_modules/vitest/vitest.mjs", "run", "-c", "vitest.unit.config.mts",
    "src/lib/config/integration-origins.test.ts", "src/server/plugins/serve-ui-headers.test.ts"]);
}
