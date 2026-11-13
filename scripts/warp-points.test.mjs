// One domain vocabulary for MCPL (docs/0120): the canonical interaction domains in
// docs/interaction/workflows.json, the MCP warp points, the MCPL workbench manifest and the
// /api/vx/v1/<domain> routers must all agree. Run by the canonical build:
//   node --experimental-strip-types --test scripts/warp-points.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { listWarpPoints, MAIN_MCP_TOOLS, MCPL_VIEWS, VAULTIX_DOMAINS, viewForTool, WARP_POINTS } from '../platform/engine/backend/src/services/vaultix/warp-points.ts';
import { DEFAULT_MCPL_MODULES, MCPL_ACTIONS, MCPL_DOMAIN_ORDER } from '../platform/engine/frontend/src/components/vaultix/mcpl-manifest.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const canonical = JSON.parse(read('docs/interaction/workflows.json')).domains.map(domain => domain.id);

test('warp points and the MCPL manifest use the canonical domains, in order', () => {
  assert.deepEqual([...VAULTIX_DOMAINS], canonical);
  assert.deepEqual(WARP_POINTS.map(point => point.domain), canonical);
  assert.deepEqual([...MCPL_DOMAIN_ORDER], canonical);
});

test('live warp points have an endpoint and tools; each tool has exactly one owner', () => {
  const { points } = listWarpPoints();
  for (const point of points) {
    assert.equal(point.endpoint, point.status === 'live' ? `/api/vx/v1/${point.domain}/mcp` : null, point.domain);
    assert.equal(point.status === 'live', point.tools.length > 0, `${point.domain}: live exactly when it has tools`);
  }
  const owned = points.flatMap(point => point.tools.map(tool => tool.name));
  assert.equal(new Set(owned).size, owned.length, 'A tool belongs to one domain');
  assert.ok(owned.every(name => /^vaultix\.[a-z]+(\.[a-z-]+)+$/.test(name)), 'Tool names are vaultix.<area>.<action>');
});

test('a tool declares at most one known view, and the warp list reports it', () => {
  const tools = WARP_POINTS.flatMap(point => point.tools);
  for (const tool of tools) {
    if (tool.view !== undefined) assert.ok(MCPL_VIEWS.includes(tool.view), `${tool.name}: unknown view ${tool.view}`);
    assert.equal(viewForTool(tool.name), tool.view, tool.name);
  }
  for (const view of MCPL_VIEWS)
    assert.ok(tools.some(tool => tool.view === view), `view ${view} is declared but no tool uses it`);
  // A view is shown on the main MCP, so a tool with a view must be listed there.
  for (const tool of tools.filter(entry => entry.view))
    assert.ok(MAIN_MCP_TOOLS.includes(tool.name), `${tool.name} has a view but is not on the main MCP`);
  const listed = listWarpPoints().points.flatMap(point => point.tools);
  assert.deepEqual(listed.map(tool => tool.view), tools.map(tool => tool.view ?? null));
  assert.equal(viewForTool('vaultix.nothing.here'), undefined);
});

test('the main MCP keeps the tools that predate warp points and adds discovery and sign-in', () => {
  for (const name of ['vaultix.warp.list', 'vaultix.auth.options.get', 'vaultix.projects.list', 'vaultix.secrets.references'])
    assert.ok(MAIN_MCP_TOOLS.includes(name), name);
  const owned = new Set(WARP_POINTS.flatMap(point => point.tools.map(tool => tool.name)));
  const mainOnly = MAIN_MCP_TOOLS.filter(name => !owned.has(name));
  assert.deepEqual(mainOnly, ['vaultix.warp.list'], 'Only discovery lives on the main MCP alone');
});

test('MCPL actions and modules sit in canonical domains', () => {
  for (const action of MCPL_ACTIONS) {
    assert.ok(canonical.includes(action.domain), `${action.id}: unknown domain ${action.domain}`);
    assert.ok(action.id.startsWith(`vaultix.ui.${action.domain}.`), `${action.id}: id and domain disagree`);
  }
  for (const module of DEFAULT_MCPL_MODULES) {
    assert.ok(canonical.includes(module.id), `module ${module.id}`);
    assert.ok(MCPL_ACTIONS.some(action => action.domain === module.id), `module ${module.id} has no actions`);
  }
});

test('Vaultix API routers mount under canonical domains', () => {
  const index = read('platform/engine/backend/src/server/routes/vx/index.ts');
  const prefixes = [...index.matchAll(/prefix:\s*"\/([a-z-]+)\//g)].map(match => match[1]);
  assert.ok(prefixes.length > 0, 'No /api/vx/v1 domain routers found');
  for (const domain of prefixes) assert.ok(canonical.includes(domain), `/api/vx/v1/${domain} is not a canonical domain`);
});
