import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("../core/frontend/src/routes.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../core/frontend/src/pages/index.tsx", import.meta.url), "utf8");
const authenticate = readFileSync(
  new URL("../core/frontend/src/pages/middlewares/authenticate.tsx", import.meta.url),
  "utf8"
);
const root = routes.slice(routes.indexOf("export const routes"));
assert.ok(root.includes('index("index.tsx")'), "root index must stay the application entry file");
assert.ok(root.indexOf('index("index.tsx")') < root.indexOf('route("/help"'), "/help must not replace the root");
assert.match(index, /VaultixLanding/);
assert.doesNotMatch(index, /from ["'].*help/i);
assert.match(authenticate, /to:\s*"\/login"/);
assert.match(authenticate, /to:\s*"\/admin\/setup"/);
console.log("Application entry files keep /, /login, and /admin/setup distinct from /help.");
