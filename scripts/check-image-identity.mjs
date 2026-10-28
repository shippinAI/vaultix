// Read actual image labels without exposing its runtime environment or requiring registry access.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const [image, kind = "engine", expectedRevision] = process.argv.slice(2);
assert.ok(image && !image.startsWith("-"), "Provide a local image name or digest");
assert.ok(["engine", "panel"].includes(kind), "Image kind must be engine or panel");
if (expectedRevision !== undefined) assert.match(expectedRevision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "Expected revision must be a full Git commit");
const repository = process.env.GITHUB_REPOSITORY || "shippinAI/vaultix";
assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const labels = JSON.parse(execFileSync("docker", ["image", "inspect", "--format", "{{json .Config.Labels}}", image], { encoding: "utf8" }));
const label = name => labels?.[`org.opencontainers.image.${name}`];
assert.equal(label("title"), kind === "engine" ? "Vaultix" : "Vaultix panel");
assert.equal(label("url"), "https://vaultix.cloud", "Image must identify the primary Vaultix product");
assert.equal(label("source"), `https://github.com/${repository}`);
assert.equal(label("vendor"), "AngryVibes LLC");
assert.equal(label("licenses"), "MIT");
assert.match(label("revision") ?? "", /^(?:uncommitted|[a-f0-9]{40}|[a-f0-9]{64})$/, "Record a commit or explicitly mark an uncommitted local build");
if (expectedRevision !== undefined) assert.equal(label("revision"), expectedRevision, "Image revision must match the release checkout");
console.log(JSON.stringify({ image, kind, url: label("url"), source: label("source"), revision: label("revision"), revisionMatchesExpected: Boolean(expectedRevision) }));
