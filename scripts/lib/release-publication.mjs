// Trusted-owner publication, using the same signature and acceptance owners as
// installation. No private signing key or downloaded trust enters this module.
import assert from 'node:assert/strict';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCanonical, sha256, verifyManifest, verifyArtifacts } from './release-bundle.mjs';
import { context, validateEvidence } from './pr-verification.mjs';

export function readPublicationFile(path, limit) {
  const absolute = resolve(path), stat = lstatSync(absolute);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'Publication input must be a bounded regular file');
  assert.equal(realpathSync(absolute), absolute, 'Publication input cannot traverse links');
  const fd = openSync(absolute, 'r');
  try {
    const opened = fstatSync(fd);
    assert.ok(opened.isFile() && opened.dev === stat.dev && opened.ino === stat.ino && opened.size === stat.size && opened.mtimeMs === stat.mtimeMs, 'Publication input changed');
    const bytes = Buffer.alloc(limit + 1);
    let count = 0, read;
    while (count < bytes.length && (read = readSync(fd, bytes, count, bytes.length - count, null)) > 0) count += read;
    const after = fstatSync(fd), current = lstatSync(absolute);
    assert.ok(count <= limit && count === stat.size && after.mtimeMs === opened.mtimeMs && !current.isSymbolicLink() && current.dev === opened.dev && current.ino === opened.ino, 'Publication input changed or exceeded its limit');
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}

export async function loadPublication({ bundle, trust, acceptance, checkpoint, notes }) {
  const directory = realpathSync(resolve(bundle));
  assert.ok(!directory.includes('#'), 'Bundle path cannot contain a gh asset-label separator');
  const raw = readPublicationFile(resolve(directory, 'release-manifest.json'), 65536);
  const signature = readPublicationFile(resolve(directory, 'release-signature.json'), 4096);
  const trusted = readPublicationFile(trust, 16384);
  const verified = verifyManifest(raw, signature, trusted, {
    previous: checkpoint ? parseCanonical(readPublicationFile(checkpoint, 4096), 4096) : null
  });
  // This known public RFC 8032 key is used throughout consumer fault fixtures.
  // Its private key is published, so it must never authorize a public release.
  assert.ok(!parseCanonical(trusted, 16384).keys.some(k => k.keyId === '06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9'), 'Public test key cannot be production release trust');
  const { manifest } = verified;
  const notesText = new TextDecoder('utf-8', { fatal: true }).decode(readPublicationFile(notes, 65536));
  assert.ok(notesText.trim(), 'Release notes are required');
  assert.ok(manifest.artifacts.every(a => a.bytes < 2 * 1024 ** 3), 'GitHub release assets must be under 2 GiB; prepare a smaller compressed artifact before signing');
  assert.ok(manifest.artifacts.every(a => !['release-manifest.json', 'release-signature.json'].includes(a.name)), 'Artifact collides with signed metadata');
  const artifacts = await verifyArtifacts(manifest, directory);
  const acceptanceBytes = readPublicationFile(acceptance, 1024 * 1024);
  const proof = JSON.parse(acceptanceBytes);
  assert.equal(proof.passed, true, 'Publication needs accepted local verification');
  assert.equal(proof.context, context);
  assert.equal(proof.revision, manifest.revision);
  assert.equal(proof.receipts?.length, 6, 'Missing canonical, CLI and lifecycle receipts');
  const receipts = proof.receipts.map(entry => {
    const bytes = readPublicationFile(entry.path, 1024 * 1024);
    assert.equal(sha256(bytes), entry.sha256, 'Acceptance receipt changed');
    return JSON.parse(bytes);
  });
  const [build, cli, lifecycle, download, install, migration] = receipts;
  validateEvidence(build, cli, manifest.revision);
  assert.equal(build.platformVersion, manifest.version, 'Build and signed version differ');
  assert.equal(proof.imageId, build.imageId);
  assert.equal(manifest.artifacts.find(a => a.kind === 'engine').imageId, build.imageId);
  for (const artifact of manifest.artifacts.filter(a => a.kind === 'cli')) {
    assert.equal(artifact.sha256, cli.cli.find(a => a.platform === artifact.platform)?.sha256, 'Bundle CLI differs from accepted CLI');
  }
  const linux = cli.cli.find(a => a.platform === 'linux/amd64');
  for (const receipt of [lifecycle, download, install, migration]) {
    assert.ok(receipt.passed && receipt.cleanupPassed && receipt.development !== true, 'Incomplete or development acceptance');
    assert.equal(receipt.revision, manifest.revision);
    assert.equal(receipt.cliSha256, linux.sha256);
  }
  for (const receipt of [lifecycle, migration]) assert.equal(receipt.candidate, build.imageId);
  const assets = [...artifacts,
    { name: 'release-manifest.json', bytes: raw.length, sha256: sha256(raw) },
    { name: 'release-signature.json', bytes: signature.length, sha256: sha256(signature) }
  ];
  assert.equal(new Set(assets.map(a => a.name)).size, assets.length, 'Artifact collides with signed metadata');
  return { directory, tag: `v${manifest.version}`, revision: manifest.revision,
    preview: manifest.channel === 'preview', assets, checkpoint: verified.checkpoint,
    acceptanceSha256: sha256(acceptanceBytes), notesSha256: sha256(Buffer.from(notesText)) };
}

export function checkLatestStable(plan, latest) {
  if (plan.preview || latest === null) return;
  assert.equal(latest.draft, false);
  assert.equal(latest.prerelease, false);
  const version = tag => {
    assert.ok(typeof tag === 'string' && tag.length <= 129);
    const parts = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(tag);
    assert.ok(parts, 'Latest stable release has an invalid version');
    const numbers = parts.slice(1, 4).map(Number);
    assert.ok(numbers.every(Number.isSafeInteger));
    return numbers;
  };
  const before = version(latest.tag_name), after = version(plan.tag);
  if (latest.tag_name === plan.tag) return;
  const index = before.findIndex((part, i) => part !== after[i]);
  assert.ok(index >= 0 && after[index] > before[index], 'Publication cannot rewind the stable channel or replace an equal-precedence version');
}

export function checkPublishedAssets(plan, listing, complete = true) {
  assert.ok(Number.isSafeInteger(listing.id) && listing.id > 0, 'Invalid release identity');
  assert.equal(listing.tag_name, plan.tag, 'Release tag changed');
  assert.equal(listing.prerelease, plan.preview, 'Release channel differs from signed manifest');
  assert.equal(typeof listing.draft, 'boolean');
  assert.equal(typeof listing.body, 'string', 'Release notes are missing');
  assert.equal(sha256(Buffer.from(listing.body)), plan.notesSha256, 'Draft notes differ from the reviewed notes file');
  assert.ok(Array.isArray(listing.assets));
  const expected = new Map(plan.assets.map(a => [a.name, a]));
  const seen = new Set();
  for (const asset of listing.assets) {
    const local = expected.get(asset.name);
    assert.ok(local && !seen.has(asset.name), 'Unexpected or duplicate release asset; no remote files were replaced');
    seen.add(asset.name);
    assert.equal(asset.state, 'uploaded', 'Release asset is not completely uploaded');
    assert.equal(asset.size, local.bytes, 'Uploaded asset size differs');
    assert.equal(asset.digest, `sha256:${local.sha256}`, 'Uploaded asset digest differs or is unavailable');
  }
  if (complete) assert.equal(seen.size, expected.size, 'Release is incomplete');
  return seen;
}

// The adapter owns GitHub effects. Checks run before the first mutation, again
// before publication, and on the published result. Mismatches leave the draft for
// investigation; this path never clobbers assets, deletes a release or moves tags.
export async function publishRelease(plan, io, mode = 'plan') {
  assert.ok(['plan', 'draft', 'stage', 'publish'].includes(mode));
  await io.verifySource(plan);
  if (mode === 'plan') return { published: false, planned: true, ...plan };
  let listing = await io.getRelease(plan.tag);
  if (mode === 'publish' && !plan.preview) {
    assert.ok(listing && listing.draft === false, 'Stage the stable candidate first, verify its public download and owned-server upgrade, then publish the same bytes as latest');
  }
  if (listing) {
    checkPublishedAssets(plan, listing, !listing.draft);
    if (!listing.draft) {
      if (mode !== 'publish' || plan.preview) return { published: true, unchanged: true, tag: plan.tag, id: listing.id };
      // Stable promotion changes only discovery metadata, never signed assets.
      await io.revalidate(plan);
      await io.verifySource(plan);
      const current = await io.getRelease(plan.tag);
      assert.equal(current.id, listing.id);
      assert.equal(current.draft, false);
      checkPublishedAssets(plan, current);
      await io.publish(listing.id, plan, true);
      const promoted = await io.getRelease(plan.tag);
      assert.equal(promoted.id, listing.id);
      assert.equal(promoted.draft, false);
      checkPublishedAssets(plan, promoted);
      await io.verifySource(plan);
      await io.verifyVisibility(plan, true);
      return { published: true, latest: true, tag: plan.tag, id: listing.id, checkpoint: plan.checkpoint };
    }
  } else listing = await io.createDraft(plan);
  const id = listing.id;
  const uploaded = checkPublishedAssets(plan, listing, false);
  assert.equal(listing.draft, true);
  for (const asset of plan.assets) {
    if (!uploaded.has(asset.name)) await io.upload(plan, asset);
  }
  await io.revalidate(plan);
  await io.verifySource(plan);
  listing = await io.getRelease(plan.tag);
  assert.equal(listing.id, id, 'Release was replaced during upload');
  assert.equal(listing.draft, true, 'Another publisher changed the draft');
  checkPublishedAssets(plan, listing);
  if (mode === 'draft') return { published: false, draft: true, tag: plan.tag, id };
  await io.publish(id, plan, false);
  const published = await io.getRelease(plan.tag);
  assert.equal(published.id, id);
  assert.equal(published.draft, false, 'GitHub did not publish the release');
  checkPublishedAssets(plan, published);
  await io.verifySource(plan);
  await io.verifyVisibility(plan, false);
  return { published: true, latest: false, tag: plan.tag, id, checkpoint: plan.checkpoint };
}
