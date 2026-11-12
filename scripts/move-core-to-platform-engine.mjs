#!/usr/bin/env node
// One-time scripted move: core/ -> platform/engine/ (docs/0122 rule 3: no unchecked bulk edits).
// Run from a clean checkout:  node scripts/move-core-to-platform-engine.mjs [--dry]
// It moves the tree with git, rewrites path references by explicit rules, and prints every
// rule's hit count per file so the diff can be classified before it is committed.
// Not touched: lockfiles, generated maps (regenerate them), binaries, JOURNAL.md, leftover/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix } from "node:path";

const dry = process.argv.includes("--dry");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const OLD = "core";
const NEW = "platform/engine";

if (!existsSync(OLD) || existsSync(NEW)) {
  console.error(`expected ${OLD}/ to exist and ${NEW}/ not to exist`);
  process.exit(1);
}
if (git("status", "--porcelain").trim() && !dry) {
  console.error("working tree is not clean");
  process.exit(1);
}

const children = git("ls-tree", "--name-only", "HEAD", `${OLD}/`)
  .split("\n").filter(Boolean).map(p => p.slice(OLD.length + 1))
  // untracked or fixture-only names that scripts and docs also reference
  .concat([".env.test", ".env", ".git", "committed.txt", "line-endings.go", "not-a-source.ts", "runtime"]);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const childAlt = children.sort((a, b) => b.length - a.length).map(escapeRe).join("|");

const skip = path =>
  /(^|\/)(package-lock\.json|go\.sum|flake\.lock|npm-shrinkwrap\.json)$/.test(path) ||
  /^docs\/(migration|capabilities)\/generated\//.test(path) ||
  path === "docs/code-audit/inventory.tsv" ||
  path === "JOURNAL.md" ||
  path.startsWith("leftover/") ||
  path === "scripts/move-core-to-platform-engine.mjs";

// Files where a quoted bare "core" is the directory, checked by hand.
const quotedBare = new Set([
  "scripts/build-self-hosted.mjs",
  "scripts/test-vaultix-policy-image.mjs",
  "scripts/test-owned-build-paths.mjs",
  "scripts/ai-journal.test.mjs",
  ".ai/contexts.json",
]);

const rules = [
  // core/<known child>, not part of a longer word such as internal/core or @vaultix/core
  ["child-path", new RegExp(`(?<![A-Za-z0-9_.@-])core/(?=(?:${childAlt})(?![A-Za-z0-9_]))`, "g"), `${NEW}/`,
    (text, index) => !/(internal|panel|vaultix|infisical)\/$/.test(text.slice(Math.max(0, index - 12), index))],
  // bare directory mention: `core/` followed by a non-name character
  ["bare-dir", /(?<![A-Za-z0-9_.@/-])core\/(?![A-Za-z0-9_.])/g, `${NEW}/`, () => true],
  // directory named after a known root prefix
  ["rooted", /(\.\.\/|\$ROOT\/|\$\{ROOT\}\/|source\/)core(?![A-Za-z0-9_/.-])/g, `$1${NEW}`, () => true],
  // docker build context in workflows and compose
  ["context", /(context:\s*)core\s*$/gm, `$1${NEW}`, () => true],
];

const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const report = [];
let changed = 0;

const moved = path => (path === OLD || path.startsWith(`${OLD}/`) ? `${NEW}${path.slice(OLD.length)}` : path);

if (!dry) {
  mkdirSync(dirname(NEW), { recursive: true });
  git("mv", OLD, NEW);
}

for (const original of tracked) {
  if (skip(original)) continue;
  const path = dry ? original : moved(original);
  let buffer;
  try { buffer = readFileSync(path); } catch { continue; }
  if (buffer.includes(0)) continue;
  let text = buffer.toString("utf8");
  const before = text;
  const hits = {};

  for (const [name, pattern, replacement, allow] of rules) {
    text = text.replace(pattern, (match, ...rest) => {
      const whole = rest[rest.length - 1];
      const index = rest[rest.length - 2];
      if (!allow(whole, index)) return match;
      hits[name] = (hits[name] || 0) + 1;
      const groups = rest.slice(0, -2);
      return replacement.replace(/\$(\d)/g, (_, n) => groups[Number(n) - 1] ?? "");
    });
  }

  if (quotedBare.has(original)) {
    text = text.replace(/(["'])core\1/g, (match, quote) => {
      hits["quoted-bare"] = (hits["quoted-bare"] || 0) + 1;
      return `${quote}${NEW}${quote}`;
    });
  }

  // A file that lived in core/ and reached above core/ with ../ now sits one level deeper.
  if (original.startsWith(`${OLD}/`)) {
    const depth = posix.dirname(original).split("/").length - 1; // directories below core/
    text = text.replace(/(?<![A-Za-z0-9_./-])((?:\.\.\/)+)(docs|contracts|scripts|branding|schemas|compose|internal|cmd|db|\.ai)\//g,
      (match, ups, target) => {
        if (ups.length / 3 !== depth + 1) return match;
        hits["escape"] = (hits["escape"] || 0) + 1;
        return `../${ups}${target}/`;
      });
  }

  if (text !== before) {
    changed += 1;
    report.push(`${original}\t${Object.entries(hits).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    if (!dry) writeFileSync(path, text);
  }
}

console.log(report.join("\n"));
console.log(`\n${dry ? "would change" : "changed"} ${changed} files; moved ${OLD}/ -> ${NEW}/`);
