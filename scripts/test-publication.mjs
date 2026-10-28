import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/publication-proof-"));
const bin = resolve(evidence, "bin");
mkdirSync(bin);
const globalConfig = resolve(evidence, "empty-git-config");
writeFileSync(globalConfig, "");
const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Vaultix fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Vaultix fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
for (const key of ["VAULTIX_GH_OWNER", "VAULTIX_GH_REPO", "VAULTIX_FORCE_PUBLISH"]) delete env[key];
const realGit = execFileSync(bash, ["-c", "command -v git"], { encoding: "utf8", env }).trim();
const wrapper = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$VAULTIX_FIXTURE_TRACE"
case "$1" in
  ls-remote)
    [[ "$*" == 'ls-remote --exit-code --heads https://github.com/shippinAI/vaultix.git refs/heads/main' ]] || exit 91
    [[ "\${VAULTIX_FIXTURE_LOOKUP_FAILURE:-0}" == 0 ]] || exit 92
    if [[ "\${VAULTIX_FIXTURE_MUTATION:-0}" == 1 ]]; then printf changed > pending-during-check; fi
    exec "$VAULTIX_FIXTURE_GIT" ls-remote --exit-code --heads "$VAULTIX_FIXTURE_REMOTE" refs/heads/main ;;
  push)
    [[ "$#" == 3 && "$2" == 'https://github.com/shippinAI/vaultix.git' && "$3" != +* ]] || exit 93
    [[ "\${VAULTIX_FIXTURE_PUSH_FAILURE:-0}" == 0 ]] || exit 94
    if [[ -n "\${VAULTIX_FIXTURE_RACE:-}" ]]; then "$VAULTIX_FIXTURE_GIT" --git-dir "$VAULTIX_FIXTURE_REMOTE" update-ref refs/heads/main "$VAULTIX_FIXTURE_RACE"; fi
    exec "$VAULTIX_FIXTURE_GIT" push "$VAULTIX_FIXTURE_REMOTE" "$3" ;;
  fetch|clone|init|commit|add|remote) exit 95 ;;
esac
[[ "$*" != *--global* ]] || exit 96
exec "$VAULTIX_FIXTURE_GIT" "$@"
`;
writeFileSync(resolve(bin, "git"), wrapper, { mode: 0o755 });
writeFileSync(resolve(bin, "gh"), '#!/usr/bin/env bash\nprintf "forbidden gh\\n" >> "$VAULTIX_FIXTURE_TRACE"\nexit 97\n', { mode: 0o755 });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function remoteTip(remote) {
  const result = spawnSync("git", ["--git-dir", remote, "show-ref", "--verify", "--quiet", "refs/heads/main"], { env, encoding: "utf8" });
  if (result.status === 1) return null;
  assert.equal(result.status, 0, result.stderr);
  return git(evidence, "--git-dir", remote, "rev-parse", "refs/heads/main");
}
const results = [];

function setup(name) {
  const cwd = resolve(evidence, name), remote = resolve(evidence, `${name}.git`);
  mkdirSync(cwd);
  git(cwd, "init", "-b", "main");
  git(cwd, "init", "--bare", remote);
  for (const folder of ["scripts", "core", "panel", ".github/workflows", "compose"]) mkdirSync(resolve(cwd, folder), { recursive: true });
  copyFileSync(resolve(root, "scripts/publish-github.sh"), resolve(cwd, "scripts/publish-github.sh"));
  for (const path of ["core/Dockerfile.standalone-vaultix", "panel/Dockerfile", ".github/workflows/ghcr.yml"]) copyFileSync(resolve(root, path), resolve(cwd, path));
  writeFileSync(resolve(cwd, ".gitignore"), "compose/vaultix.env\n");
  writeFileSync(resolve(cwd, "compose/vaultix.env"), "FIXTURE_ONLY=never-copy-this-file\n");
  git(cwd, "config", "remote.origin.url", "https://github.com/shippinAI/vaultix.git");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Fixture base");
  const base = git(cwd, "rev-parse", "HEAD");
  git(cwd, "push", remote, "HEAD:refs/heads/main");
  writeFileSync(resolve(cwd, "reviewed.txt"), "Reviewed fixture change\n");
  git(cwd, "add", "reviewed.txt");
  git(cwd, "commit", "-m", "Fixture reviewed change");
  return { cwd, remote, base, head: git(cwd, "rev-parse", "HEAD") };
}

function run(name, { mode = "--push", change = () => {}, variables = {}, expected = 2, message, published = false } = {}) {
  const fixture = setup(name);
  change(fixture, variables);
  const before = git(fixture.cwd, "rev-parse", "HEAD");
  const remoteBefore = remoteTip(fixture.remote);
  const trace = resolve(evidence, `${name}-commands.txt`);
  const prefix = process.platform === "win32" ? 'fixture_bin="$(cygpath -u "$VAULTIX_FIXTURE_BIN")";' : 'fixture_bin="$VAULTIX_FIXTURE_BIN";';
  const result = spawnSync(bash, ["-c", `${prefix} export PATH="$fixture_bin:$PATH"; exec bash "$1/scripts/publish-github.sh"${mode ? ' "$2"' : ''}`, "fixture", fixture.cwd, mode ?? ""], {
    encoding: "utf8", timeout: 30_000, env: { ...env, VAULTIX_FIXTURE_BIN: bin,
      VAULTIX_FIXTURE_GIT: realGit, VAULTIX_FIXTURE_REMOTE: fixture.remote,
      VAULTIX_FIXTURE_TRACE: trace, ...variables }
  });
  const commands = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n") : [];
  writeFileSync(resolve(evidence, `${name}-result.json`), JSON.stringify({ fixtures: true, status: result.status, stdout: result.stdout, stderr: result.stderr, commands }, null, 2));
  assert.equal(result.status, expected, `${name}: ${result.stdout}${result.stderr}`);
  if (message) assert.match(result.stdout + result.stderr, message, name);
  assert.equal(git(fixture.cwd, "rev-parse", "HEAD"), before, "Publication must not change local history");
  assert.equal(remoteTip(fixture.remote), published ? before : variables.VAULTIX_FIXTURE_RACE ?? remoteBefore, "Only successful publication or the explicit concurrent-writer fixture may advance remote main");
  assert.equal(commands.filter(command => command.startsWith("push ")).length, published || variables.VAULTIX_FIXTURE_PUSH_FAILURE || variables.VAULTIX_FIXTURE_RACE ? 1 : 0);
  assert.ok(commands.every(command => !/^(fetch|clone|init|commit|add|remote|forbidden gh)\b|--force|--global/.test(command)), "No forbidden fallback commands");
  assert.ok(!(result.stdout + result.stderr).includes("never-copy-this-file"));
  if (published) {
    assert.ok(commands.includes(`push https://github.com/shippinAI/vaultix.git ${before}:refs/heads/main`));
    assert.equal(git(fixture.cwd, "--git-dir", fixture.remote, "ls-tree", "--name-only", "main", "compose/vaultix.env"), "");
  }
  results.push({ name, passed: true, fixtures: true });
}

try {
  run("preflight", { mode: "--check", expected: 0, message: /no push or image publication/ });
  run("publish", { expected: 0, published: true, message: /does not establish a published/ });
  run("default-publish", { mode: null, expected: 0, published: true });
  run("untracked", { change: ({ cwd }) => writeFileSync(resolve(cwd, "pending.txt"), "pending"), message: /tree must be clean/ });
  run("staged", { change: ({ cwd }) => { writeFileSync(resolve(cwd, "reviewed.txt"), "pending"); git(cwd, "add", "reviewed.txt"); }, message: /tree must be clean/ });
  run("detached", { change: ({ cwd }) => git(cwd, "checkout", "--detach"), message: /Detached HEAD/ });
  run("branch", { change: ({ cwd }) => git(cwd, "checkout", "-b", "pending"), message: /Only the existing main/ });
  run("origin", { change: ({ cwd }) => git(cwd, "config", "remote.origin.url", "https://github.com/other/project.git"), message: /Origin does not match/ });
  run("push-url", { change: ({ cwd }) => git(cwd, "config", "remote.origin.pushurl", "https://github.com/other/project.git"), message: /alternate origin push URL/ });
  run("rewrite", { change: ({ cwd }) => git(cwd, "config", "url.https://unreachable.invalid/.insteadOf", "https://github.com/"), message: /URL rewrites/ });
  for (const [name, path] of [["standalone", "core/Dockerfile.standalone-vaultix"], ["panel", "panel/Dockerfile"], ["workflow", ".github/workflows/ghcr.yml"]]) {
    run(`missing-${name}`, { change: ({ cwd }) => { git(cwd, "rm", path); git(cwd, "commit", "-m", "Fixture missing input"); }, message: /committed application is missing/ });
  }
  run("tracked-env", { change: ({ cwd }) => { git(cwd, "add", "-f", "compose/vaultix.env"); git(cwd, "commit", "-m", "Fixture tracked operator config"); }, message: /must not be tracked/ });
  run("lookup-failure", { variables: { VAULTIX_FIXTURE_LOOKUP_FAILURE: "1" }, message: /Cannot read/ });
  run("missing-main", { change: ({ cwd, remote }) => git(cwd, "--git-dir", remote, "update-ref", "-d", "refs/heads/main"), message: /Cannot read/ });
  run("unknown-tip", { change: ({ cwd, remote }) => {
    const other = resolve(evidence, "unknown-history"); mkdirSync(other); git(other, "init", "-b", "main");
    writeFileSync(resolve(other, "unrelated"), "fixture"); git(other, "add", "."); git(other, "commit", "-m", "Unrelated fixture");
    const sha = git(other, "rev-parse", "HEAD");
    git(cwd, "--git-dir", remote, "update-ref", "-d", "refs/heads/main");
    git(other, "push", remote, `${sha}:refs/heads/main`);
  }, message: /not available locally/ });
  run("divergent", { change: ({ cwd, remote, base }) => {
    git(cwd, "checkout", "-b", "divergence", base); writeFileSync(resolve(cwd, "divergent"), "fixture");
    git(cwd, "add", "."); git(cwd, "commit", "-m", "Divergent fixture"); git(cwd, "push", remote, "HEAD:refs/heads/main"); git(cwd, "checkout", "main");
  }, message: /not an ancestor/ });
  run("push-failure", { variables: { VAULTIX_FIXTURE_PUSH_FAILURE: "1" }, message: /Source push failed/ });
  run("concurrent-remote", { change: ({ cwd, remote, base }, variables) => {
    git(cwd, "checkout", "-b", "race", base); writeFileSync(resolve(cwd, "concurrent"), "fixture");
    git(cwd, "add", "."); git(cwd, "commit", "-m", "Concurrent writer fixture");
    variables.VAULTIX_FIXTURE_RACE = git(cwd, "rev-parse", "HEAD");
    git(cwd, "push", remote, "HEAD:refs/heads/race"); git(cwd, "checkout", "main");
  }, message: /Source push failed/ });
  run("changed-during-check", { variables: { VAULTIX_FIXTURE_MUTATION: "1" }, message: /checkout changed during preflight/ });
  run("force-option", { variables: { VAULTIX_FORCE_PUBLISH: "1" }, message: /no longer supported/ });
  run("invalid-owner", { variables: { VAULTIX_GH_OWNER: "../other" }, message: /Invalid GitHub owner/ });
  console.log(`Publication fixtures passed: ${results.length}. Evidence: ${evidence}`);
} finally {
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify({ fixtures: true, passed: results.length === 23, cases: results }, null, 2));
}
