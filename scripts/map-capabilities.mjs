import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { capabilities, groups, phases, sources } from "../docs/capabilities/catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const groupIds = new Set(groups.map((group) => group.id));
const apiGroups = {
  "app-connections": "connect",
  "secret-syncs": "connect",
  "secret-rotations": "automation",
  "cert-manager": "pki",
  pki: "pki",
  auth: "access",
  projects: "workspace",
  workspace: "workspace",
  "secret-scanning": "detect",
  secrets: "secrets",
  kms: "kms",
  folders: "secrets",
  groups: "access",
  "secret-imports": "secrets",
  "dynamic-secrets": "automation",
  organizations: "workspace",
  organization: "workspace",
  vaultix: "ai",
  identities: "access",
  "identity-templates": "access",
  "additional-privilege": "access",
  "integration-auth": "connect",
  "proxied-services": "connect",
  "identity-project-additional-privilege": "access",
  sso: "access",
  integration: "connect",
  "project-templates": "workspace",
  "shared-secrets": "secrets",
  "sub-organizations": "workspace",
  gateways: "connect",
  ldap: "access",
  scim: "access",
  relays: "connect",
  "service-token": "access",
  admin: "operate",
  events: "governance",
};
const workstreamGroups = {
  foundation: "operate",
  identity: "access",
  authorization: "access",
  ui: "experience",
  secrets: "secrets",
  ai: "ai",
  delivery: "operate",
  cli: "secrets",
  automation: "automation",
  integrations: "connect",
  audit: "governance",
  kms: "kms",
  pki: "pki",
  pam: "pam",
  scanning: "detect",
  "legacy-panel": "operate",
};

export function apiGroup(operation) {
  const path = operation.split(" ")[1];
  assert.match(path ?? "", /^\/api\/v\d+\//, `Unclassified API operation: ${operation}`);
  const family = path.split("/")[3];
  assert.ok(apiGroups[family], `Unclassified API family: ${family}`);
  return apiGroups[family];
}
export function uiGroup(path) {
  const entry = path.split("/")[1];
  if (!entry) return "workspace";
  if (
    [
      "login",
      "signup",
      "signupinvite",
      "account-recovery",
      "account-recovery-reset",
      "mfa-session",
      "password-setup",
      "email-not-verified",
      "requestnewinvite",
      "cli-redirect",
      "personal-settings",
    ].includes(entry)
  )
    return "access";
  if (entry === "help") return "experience";
  if (["secret-request", "share-secret", "shared"].includes(entry)) return "secrets";
  if (entry === "admin") return "operate";
  if (entry === "integrations") return "connect";
  if (entry === "pam") return "pam";
  assert.ok(["organization", "organizations"].includes(entry), `Unclassified UI entry: ${path}`);
  if (/\/audit-logs(?:\/|$)/.test(path)) return "governance";
  if (
    /\/(access-management|members|groups|identities|roles|oauth-applications|oauth-consent)(?:\/|$)/.test(
      path,
    )
  )
    return "access";
  if (/\/(app-connections|integrations|networking)(?:\/|$)/.test(path)) return "connect";
  if (/\/pam(?:\/|$)/.test(path)) return "pam";
  if (/\/cert-manager(?:\/|$)/.test(path)) return "pki";
  if (/\/kms(?:\/|$)/.test(path)) return "kms";
  if (/\/secret-scanning(?:\/|$)/.test(path)) return "detect";
  if (/\/secret-management(?:\/|$)/.test(path)) return "secrets";
  return "workspace";
}
export function validateCatalog(records = capabilities, stages = phases) {
  const states = new Set([
    "Existing / review required",
    "Scoped evidence",
    "Known semantic gap",
    "Planned",
    "Decision pending",
  ]);
  assert.equal(
    new Set(records.map((item) => item.id)).size,
    records.length,
    "Duplicate capability IDs",
  );
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  assert.equal(stageMap.size, stages.length, "Duplicate phase IDs");
  const visited = new Set(),
    active = new Set();
  function visit(id) {
    assert.ok(stageMap.has(id), `Unknown phase ${id}`);
    assert.ok(!active.has(id), `Cyclic phase ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    stageMap.get(id).dependsOn.forEach(visit);
    active.delete(id);
    visited.add(id);
  }
  stages.forEach((stage) => visit(stage.id));
  for (const item of records) {
    assert.ok(
      states.has(item.implementation),
      `Unknown implementation state ${item.implementation}`,
    );
    assert.ok(groupIds.has(item.group), `Unknown group ${item.group}`);
    assert.ok(stageMap.has(item.phase), `Unknown phase ${item.phase}`);
    for (const key of [
      "title",
      "outcome",
      "acceptance",
      "implementation",
      "evidence",
      "target",
      "ai",
      "offering",
    ])
      assert.ok(typeof item[key] === "string" && item[key].trim(), `${item.id}: missing ${key}`);
    assert.equal(item.evidence, "Not accepted end to end", "Discovery cannot certify a workflow");
    assert.ok(Array.isArray(item.references));
    item.references.forEach((path) =>
      assert.ok(existsSync(resolve(root, path)), `${item.id}: missing reference ${path}`),
    );
    if (item.implementation === "Scoped evidence")
      assert.ok(item.references.length, `${item.id}: scoped evidence needs references`);
  }
}

export function generate() {
  validateCatalog();
  const baseline = JSON.parse(
    readFileSync(resolve(root, "contracts/vaultix-capability-surface.v1.json"), "utf8"),
  );
  const surface = [
    ...baseline.uiRoutes.map((value) => ({ kind: "UI", value, group: uiGroup(value) })),
    ...baseline.apiOperations.map((value) => ({ kind: "API", value, group: apiGroup(value) })),
  ];
  assert.equal(
    new Set(surface.map((row) => `${row.kind}:${row.value}`)).size,
    surface.length,
    "Duplicate surface entries",
  );
  const [header, ...input] = readFileSync(
    resolve(root, "docs/migration/generated/files.tsv"),
    "utf8",
  )
    .trim()
    .split(/\r?\n/);
  assert.equal(
    header,
    "path\tmodule\tworkstream\ttarget\tlanguage\tgit_blob\treview_state",
    "Unexpected migration map schema",
  );
  const source = input.map((line) => {
    assert.equal(line.split("\t").length, 7, "Malformed migration map row");
    const [path, module, workstream, , , blob, review] = line.split("\t");
    assert.ok(workstreamGroups[workstream], `Unclassified source workstream: ${workstream}`);
    return { path, module, group: workstreamGroups[workstream], workstream, blob, review };
  });
  const providerRoots = [
    ["Connection", "core/backend/src/services/app-connection"],
    ["Connection extension", "core/backend/src/ee/services/app-connections"],
    ["Sync", "core/backend/src/services/secret-sync"],
    ["Sync extension", "core/backend/src/ee/services/secret-sync"],
    ["Rotation", "core/backend/src/ee/services/secret-rotation-v2"],
    ["Dynamic credentials", "core/backend/src/ee/services/dynamic-secret/providers"],
  ];
  const providers = providerRoots
    .flatMap(([family, path]) => {
      assert.ok(existsSync(resolve(root, path)), `Missing provider root: ${path}`);
      return readdirSync(resolve(root, path), { withFileTypes: true })
        .filter((entry) => source.some((file) => entry.isDirectory()
          ? file.path.startsWith(`${path}/${entry.name}/`)
          : file.path === `${path}/${entry.name}`))
        .filter((entry) =>
          entry.isDirectory()
            ? !["shared", "schemas", "helpers"].includes(entry.name)
            : family === "Dynamic credentials" &&
              entry.name.endsWith(".ts") &&
              !["index.ts", "models.ts", "templateUtils.ts", "templateUtils.test.ts"].includes(
                entry.name,
              ),
        )
        .map((entry) => ({
          family,
          name: entry.name.replace(/\.ts$/, ""),
          path: `${path}/${entry.name}`,
          evidence: "Discovered adapter; provider acceptance pending",
        }));
    })
    .sort((a, b) => `${a.family}:${a.name}`.localeCompare(`${b.family}:${b.name}`, "en"));
  const domainCounts = Object.fromEntries(
    groups.map((group) => [
      group.id,
      {
        capabilities: capabilities.filter((item) => item.group === group.id).length,
        ui: surface.filter((item) => item.group === group.id && item.kind === "UI").length,
        api: surface.filter((item) => item.group === group.id && item.kind === "API").length,
        sourceFiles: source.filter((item) => item.group === group.id).length,
      },
    ]),
  );
  return {
    schemaVersion: 1,
    baselineCommit: baseline.sourceCommit,
    scope:
      "Planning and structural discovery only; no new workflow, provider or compliance acceptance",
    groups,
    phases,
    capabilities,
    sources,
    providers,
    domainCounts,
    coverage: {
      uiRoutes: baseline.uiRoutes.length,
      apiOperations: baseline.apiOperations.length,
      sourceFiles: source.length,
      providerEntries: providers.length,
      capabilityRequirements: capabilities.length,
      unclassified: 0,
    },
    surface,
    source,
  };
}

export function artifacts(data) {
  const { surface, source, ...summary } = data;
  return {
    "catalog.json": JSON.stringify(summary, null, 2) + "\n",
    "surface-map.tsv":
      "kind\tgroup\tsurface\n" +
      surface.map((row) => `${row.kind}\t${row.group}\t${row.value}`).join("\n") +
      "\n",
    "source-map.tsv":
      "path\tgroup\tworkstream\tmodule\tgit_blob\treview_state\n" +
      source
        .map((row) =>
          [row.path, row.group, row.workstream, row.module, row.blob, row.review].join("\t"),
        )
        .join("\n") +
      "\n",
  };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2] ?? "--check";
  assert.ok(["--write", "--check"].includes(mode), "Use --write or --check");
  const data = generate(),
    destination = resolve(root, "docs/capabilities/generated");
  if (mode === "--write") mkdirSync(destination, { recursive: true });
  for (const [name, content] of Object.entries(artifacts(data))) {
    const path = resolve(destination, name);
    if (mode === "--write") writeFileSync(path, content);
    else
      assert.equal(
        readFileSync(path, "utf8").replace(/\r\n/g, "\n"),
        content,
        `Stale capability map: ${name}`,
      );
  }
  console.log(JSON.stringify(data.coverage));
}
