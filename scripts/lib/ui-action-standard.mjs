import {createHash} from 'node:crypto';
import {readFileSync, realpathSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from '../../.ai/node_modules/ajv/dist/2020.js';
import addFormats from '../../.ai/node_modules/ajv-formats/dist/index.js';
import {groups} from '../../docs/capabilities/catalog.mjs';
import {referenceCommandCatalog} from '../../core/frontend/src/components/vaultix/reference-commands.ts';

// Offline contract/coverage tooling only. This module neither authorizes nor dispatches UI actions.
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const schema = JSON.parse(readFileSync(new URL('../../contracts/vaultix.ui-actions.v1.schema.json', import.meta.url)));
const ajv = new Ajv2020({strict:true, allErrors:true});
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(schema.$id);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  : JSON.stringify(value);
export const definitionDigest = definition => createHash('sha256').update(canonical(definition)).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const unique = (items, label) => check(new Set(items).size === items.length, `Duplicate ${label}`);
export function validateRecord(record) {
  check(validate(record), `Invalid UI record: ${ajv.errorsText(validate.errors)}`);
  return record;
}
export function readManifest() {
  return JSON.parse(readFileSync(new URL('../../docs/interaction/workflows.json', import.meta.url)));
}
function sourceFile(path) {
  check(path.split('/').every(part => part !== '.' && part !== '..'), 'Source path traversal');
  const base = realpathSync(root);
  const actual = realpathSync(resolve(root,path));
  const inside = relative(base,actual);
  check(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\'), 'Source outside repository');
  return readFileSync(actual,'utf8');
}
export function validateManifest(manifest) {
  validateRecord(manifest);
  check(manifest.kind === 'manifest','Expected manifest');
  const expectedDomains = ['public','auth',...groups.map(group => group.id)].sort();
  check(JSON.stringify(manifest.domains.map(domain => domain.id).sort()) === JSON.stringify(expectedDomains),'Domain catalog mismatch');
  unique(manifest.actions.map(action => action.id),'action');
  unique(manifest.scripts.map(script => script.id),'script');
  unique([...manifest.actions,...manifest.scripts].map(item => item.id),'action/script ID');
  const byId = new Map(manifest.actions.map(action => [action.id,action]));
  for (const action of manifest.actions) {
    check(action.id.startsWith(`vaultix.ui.${action.domain}.`),'Action domain mismatch');
    const source = sourceFile(action.source.path);
    // Detect stale links, not semantic authorship. Human handler review remains required.
    check(source.includes(action.source.handler),`Missing source anchor: ${action.id}`);
    if (action.domain === 'public') check(action.surfaces.every(s => s === 'public'),'Public action crosses authentication boundary');
    if (action.domain === 'auth') check(action.surfaces.every(s => s === 'auth'),'Auth action crosses surface boundary');
    if (action.effect === 'human-only') {
      check(action.confirmation === 'human' && action.replay === 'never','Human boundary cannot be automated');
      check(action.inputSchema === '#/$defs/emptyInput','Human input must never be serialized');
    }
    if (action.effect === 'mutation') check(action.confirmation === 'human' && action.replay === 'never','Mutation review/replay policy invalid');
    if (action.effect !== 'read') check(action.replay === 'never','Only reads can request revalidation');
    if (action.status === 'local') {
      check(action.source.command && action.target,'Local command requires mapped target and command');
      if (action.effect === 'read' || action.effect === 'mutation') check(action.sourceAction && action.permission,'Source authority missing');
    }
  }
  const mapped = manifest.actions.filter(action => action.source.command?.startsWith('reference.'));
  check(mapped.length === referenceCommandCatalog.length,'Reference command coverage mismatch');
  unique(mapped.map(action => action.source.command),'reference command');
  for (const command of referenceCommandCatalog) {
    const action = mapped.find(action => action.source.command === command.id);
    check(action && action.domain === 'secrets' && action.status === 'local' && action.target === command.target && action.effect === command.effect
      && action.sourceAction === (command.source ?? null),'Reference command mapping drift');
    const expectedInput = command.id === 'reference.folder' ? 'folderInput'
      : ['reference.project','reference.environment'].includes(command.id) ? 'valueInput' : 'emptyInput';
    check(action.inputSchema === `#/$defs/${expectedInput}`,'Reference input mapping drift');
  }
  for (const script of manifest.scripts) {
    check(script.id.startsWith(`vaultix.ui.${script.domain}.`),'Script domain mismatch');
    for (const step of script.steps) {
      const action = byId.get(step.action);
      check(action && action.domain === script.domain && action.surfaces.includes(script.surface),'Unknown or cross-domain/surface step');
      check(action.effect !== 'human-only','Script cannot perform human-only steps');
      check((action.inputSchema === '#/$defs/emptyInput') === (step.valueFrom === null),'Script input binding mismatch');
      if (action.inputSchema === '#/$defs/folderInput') check(step.valueFrom === 'folder','Folder parameter mismatch');
      if (action.source.command === 'reference.project') check(step.valueFrom === 'project','Project parameter mismatch');
      if (action.source.command === 'reference.environment') check(step.valueFrom === 'environment','Environment parameter mismatch');
    }
  }
  return manifest;
}

// Validates design fixtures and local adapters. Even a valid invocation has no remote authority.
export function validateInvocation(manifest, invocation, binding, {now = Date.now(), mode = 'local'} = {}) {
  check(mode === 'local','Remote execution is not implemented');
  validateManifest(manifest);
  validateRecord(invocation);
  validateRecord(binding);
  check(invocation.kind === 'invocation' && binding.kind === 'binding','Wrong envelope kind');
  check(Buffer.byteLength(JSON.stringify(invocation)) <= 8192,'Invocation exceeds byte limit');
  const action = manifest.actions.find(item => item.id === invocation.action);
  check(action && action.status === 'local' && action.effect !== 'human-only','Action unavailable');
  check(binding.available && binding.action === action.id,'Binding unavailable');
  check(action.surfaces.includes(invocation.scope.surface),'Action surface mismatch');
  if (invocation.scope.surface === 'tenant') check(invocation.scope.tenant !== null,'Tenant required');
  else check(invocation.scope.tenant === null && invocation.scope.resource === null,'Public/auth scope cannot contain tenant resources');
  check(binding.view === invocation.view && binding.generation === invocation.generation
    && canonical(binding.scope) === canonical(invocation.scope),'Stale or mismatched binding');
  check(binding.target === action.target,'Target mismatch');
  const digest = definitionDigest(action);
  check(binding.definitionDigest === digest && invocation.definitionDigest === digest,'Definition digest mismatch');
  const expiry = Date.parse(invocation.expiresAt);
  check(Number.isFinite(now) && expiry > now && expiry - now <= 30000,'Expired or excessive delivery lease');
  check(ajv.getSchema(`${schema.$id}${action.inputSchema}`)(invocation.input),'Action input mismatch');
  return action;
}

export function discoverySummary(manifest, domain) {
  validateManifest(manifest);
  if (domain !== undefined) check(manifest.domains.some(item => item.id === domain),'Unknown domain');
  const actions = manifest.actions.filter(item => !domain || item.domain === domain);
  return {version:1,domain:domain ?? null,local:actions.filter(item => item.status === 'local').map(item => item.id),
    planned:actions.filter(item => item.status === 'planned').map(item => item.id),remote:[],
    meaning:'Offline coverage only; no MCP registration or dispatch.'};
}
