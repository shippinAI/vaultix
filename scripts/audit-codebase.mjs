// Inventory is not review evidence. Only explicit, content-matched records count.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "--check";
if (!["--write", "--check"].includes(mode)) throw new Error("Use --write or --check.");
const inventoryPath = "docs/code-audit/inventory.tsv";
const reviewsPath = "docs/code-audit/reviews.json";
const git = (args, input) => execFileSync("git", args, {
  cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, input
});
const paths = [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .split("\0").filter(Boolean))]
  .filter(path => path !== inventoryPath && path !== reviewsPath)
  .sort();
if (paths.some(path => /[\r\n\t]/.test(path))) throw new Error("Inventory paths must not contain tabs or newlines.");
const present = paths.filter(path => existsSync(resolve(root, path)));
// Git applies the repository's clean filters, so CRLF checkouts match committed blobs.
const hashes = git(["hash-object", "--stdin-paths"], `${present.map(path => JSON.stringify(path)).join("\n")}\n`)
  .trim().split(/\r?\n/);
if (hashes.length !== present.length) throw new Error("Incomplete content inventory.");
const blobs = new Map(present.map((path, index) => [path, hashes[index]]));
const reviewFile = JSON.parse(readFileSync(resolve(root, reviewsPath), "utf8").replace(/^\uFEFF/, ""));
if (reviewFile.schemaVersion !== 1 || !Array.isArray(reviewFile.files)) throw new Error("Unsupported review ledger.");
const reviews = new Map();
const pathSet = new Set(paths);
for (const review of reviewFile.files) {
  if (!pathSet.has(review.path) || reviews.has(review.path) ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(review.blob) ||
      !["reviewed", "authored", "verified"].includes(review.status) ||
      !["retain", "modify", "replace", "remove", "investigate"].includes(review.decision) ||
      typeof review.scope !== "string" || !review.scope.trim() ||
      !Array.isArray(review.evidence) || !review.evidence.length ||
      !review.evidence.every(item => typeof item === "string" && item.trim())) {
    throw new Error(`Invalid explicit review record: ${review.path}`);
  }
  reviews.set(review.path, review);
}
const kind = path => {
  if (path.startsWith("leftover/")) return "archive";
  if (path.startsWith("core/backend-go/third_party/")) return "vendored";
  if (/routeTree\.gen\.tsx?$/.test(path) || path.startsWith("docs/migration/generated/")) return "generated";
  if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|mp4|pdf)$/i.test(path)) return "asset";
  if (/\.(md|mdx|txt)$/i.test(path) || /(?:^|\/)(LICENSE|NOTICE)(\.|$)/.test(path)) return "documentation";
  if (/\.(test|spec)\.[^/]+$|_test\.go$/.test(path) || /(?:^|\/)(?:e2e-test|tests?|__tests__)\//.test(path)) return "test";
  if (/package-lock\.json$|(?:^|\/)(go\.sum|Cargo\.lock)$/.test(path)) return "dependency-lock";
  if (path.startsWith(".github/") || path.startsWith("compose/") || path.startsWith("scripts/") ||
      /(?:^|\/)(Dockerfile[^/]*|[^/]+\.ya?ml)$/.test(path)) return "build-and-operations";
  // Inherited core and ee/ code are product code, never excluded as vendor code.
  return "product-code";
};
const rows = paths.map(path => {
  const blob = blobs.get(path);
  const review = reviews.get(path);
  const status = !blob ? "missing" : !review ? "unread" : review.blob !== blob ? "stale" : review.status;
  return { path, blob: blob ?? "-", kind: kind(path), status };
});
const inventory = "path\tgit_blob\tkind\treview_status\n" + rows
  .map(row => `${row.path}\t${row.blob}\t${row.kind}\t${row.status}`).join("\n") + "\n";
if (mode === "--write") writeFileSync(resolve(root, inventoryPath), inventory);
else if (!existsSync(resolve(root, inventoryPath)) ||
    readFileSync(resolve(root, inventoryPath), "utf8").replace(/\r\n/g, "\n") !== inventory) {
  throw new Error("Inventory changed. Inspect the changes, then run node scripts/audit-codebase.mjs --write.");
}
const counts = key => rows.reduce((result, row) => ({ ...result, [row[key]]: (result[row[key]] ?? 0) + 1 }), {});
console.log(JSON.stringify({ files: rows.length, kinds: counts("kind"), review: counts("status") }, null, 2));
if (rows.some(row => row.status === "missing" || row.status === "stale")) {
  console.error("Missing files or changed reviewed content require explicit review.");
  process.exitCode = 1;
}
