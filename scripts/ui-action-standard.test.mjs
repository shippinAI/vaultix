import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {definitionDigest,discoverySummary,readManifest,root,validateInvocation,validateManifest,validateRecord} from './lib/ui-action-standard.mjs';

const now = Date.parse('2026-11-03T12:00:00Z');
const fresh = () => {
  const manifest = readManifest();
  const action = manifest.actions.find(item => item.id === 'vaultix.ui.secrets.reference.folder');
  const scope = {surface:'tenant',tenant:'tenant-a',resource:'project-a'};
  const binding = {kind:'binding',version:1,action:action.id,definitionDigest:definitionDigest(action),
    view:'view-a',generation:1,scope,target:'reference-path',available:true};
  const invocation = {kind:'invocation',version:1,invocationId:'invocation-a',action:action.id,definitionDigest:definitionDigest(action),
    controlSession:'control-a',view:'view-a',generation:1,sequence:1,scope:structuredClone(scope),
    expiresAt:'2026-11-03T12:00:20Z',input:{value:'/service'}};
  return {manifest,binding,invocation};
};
test('canonical ledger joins existing command consumer; offline domain discovery is explicit',() => {
  const manifest = validateManifest(readManifest());
  assert.equal(manifest.domains.length,15);
  assert.deepEqual(discoverySummary(manifest,'secrets').local,[
    'vaultix.ui.secrets.reference.project','vaultix.ui.secrets.reference.environment',
    'vaultix.ui.secrets.reference.folder','vaultix.ui.secrets.reference.load','vaultix.ui.secrets.reference.reset'
  ]);
  for (const domain of manifest.domains) assert.deepEqual(discoverySummary(manifest,domain.id).remote,[]);
  assert.throws(() => discoverySummary(manifest,'imaginary'),/Unknown domain/);
});
test('local fixture validates exact envelope and action-specific input without dispatch',() => {
  const {manifest,invocation,binding} = fresh();
  assert.equal(validateInvocation(manifest,invocation,binding,{now}).source.command,'reference.folder');
  assert.throws(() => validateInvocation(manifest,invocation,binding,{now,mode:'remote'}),/not implemented/);
});
for (const [name,mutate,expected] of [
  ['unknown version',x => x.version=2,/Invalid UI record/],
  ['unknown payload field',x => x.input.password='synthetic-canary',/Invalid UI record/],
  ['actor spoof',x => x.actor='owner',/Invalid UI record/],
  ['arbitrary selector',x => x.selector='body',/Invalid UI record/],
  ['unbounded value',x => x.input.value='a'.repeat(1025),/Invalid UI record/],
  ['wrong folder shape',x => x.input.value='relative',/input mismatch/],
  ['missing required input',x => x.input={},/input mismatch/],
  ['tenant absent',x => x.scope.tenant=null,/Tenant required/],
  ['tenant mismatch',x => x.scope.tenant='tenant-b',/mismatched binding/],
  ['resource mismatch',x => x.scope.resource='project-b',/mismatched binding/],
  ['public tenant leakage',x => x.scope.surface='public',/cannot contain tenant/],
  ['surface mismatch',x => x.scope.surface='auth',/surface mismatch/],
  ['stale view',x => x.view='view-b',/mismatched binding/],
  ['stale generation',x => x.generation=2,/mismatched binding/],
  ['invalid sequence',x => x.sequence=0,/Invalid UI record/],
  ['stale definition',x => x.definitionDigest='0'.repeat(64),/digest mismatch/],
  ['expired',x => x.expiresAt='2026-11-03T11:59:59Z',/delivery lease/],
  ['excessive lease',x => x.expiresAt='2026-11-03T12:01:00Z',/delivery lease/],
  ['invalid timestamp',x => x.expiresAt='tomorrow',/Invalid UI record/],
  ['human boundary',x => x.action='vaultix.ui.auth.credentials.enter',/Action unavailable/],
  ['planned action',x => x.action='vaultix.ui.public.video.open',/Action unavailable/]
]) test(`invocation rejects ${name}`,() => {
  const {manifest,invocation,binding} = fresh();
  mutate(invocation);
  assert.throws(() => validateInvocation(manifest,invocation,binding,{now}),expected);
});
for (const [name,mutate,expected] of [
  ['duplicate action',m => m.actions.push({...m.actions[0],label:'Duplicate'}),/Duplicate action/],
  ['lost current command',m => m.actions.splice(0,1),/coverage mismatch/],
  ['wrong target',m => m.actions[0].target='other-target',/mapping drift/],
  ['wrong source authority',m => m.actions.find(a => a.effect==='read').sourceAction='vaultix.projects.list',/mapping drift/],
  ['missing permission',m => m.actions.find(a => a.effect==='read').permission=null,/authority missing/],
  ['wrong input contract',m => m.actions[0].inputSchema='#/$defs/emptyInput',/input mapping drift/],
  ['undeclared domain',m => m.actions[0].domain='other',/Invalid UI record/],
  ['wrong namespace',m => m.actions[0].id='vaultix.ui.public.reference.project',/domain mismatch/],
  ['missing domain',m => m.domains.pop(),/Invalid UI record/],
  ['duplicate domain',m => m.domains[1]=structuredClone(m.domains[0]),/Invalid UI record/],
  ['unknown script step',m => m.scripts[0].steps[0].action='vaultix.ui.secrets.missing',/Unknown or cross/],
  ['cross-domain script',m => m.scripts[0].steps[0].action='vaultix.ui.public.video.open',/Unknown or cross/],
  ['recursive script',m => m.scripts[0].steps[0].action=m.scripts[0].id,/Unknown or cross/],
  ['unbounded script',m => m.scripts[0].steps=Array.from({length:9},(_,i)=>({action:`vaultix.ui.secrets.step${i}`,valueFrom:null})),/Invalid UI record/],
  ['missing argument binding',m => m.scripts[0].steps[0].valueFrom=null,/input binding mismatch/],
  ['swapped project parameter',m => m.scripts[0].steps[0].valueFrom='environment',/Project parameter mismatch/],
  ['swapped environment parameter',m => m.scripts[0].steps[1].valueFrom='project',/Environment parameter mismatch/],
  ['remote admission',m => m.actions[0].remote=true,/Invalid UI record/],
  ['remote script admission',m => m.scripts[0].remote=true,/Invalid UI record/],
  ['credential transport',m => m.actions.find(a => a.effect==='human-only').inputSchema='#/$defs/valueInput',/never be serialized/],
  ['unsafe mutation',m => m.actions.find(a => a.status==='planned').effect='mutation',/review\/replay policy/],
  ['unsafe replay',m => m.actions[0].replay='read-revalidate',/Only reads/],
  ['source traversal',m => m.actions[0].source.path='../outside.ts',/Invalid UI record|traversal/],
  ['missing source',m => m.actions[0].source.path='core/not-a-source.ts',/ENOENT/],
  ['missing handler',m => m.actions[0].source.handler='handler-that-does-not-exist',/Missing source anchor/],
  ['external input schema',m => m.actions[0].inputSchema='https://example.invalid/schema',/Invalid UI record/]
]) test(`ledger rejects ${name}`,() => {
  const manifest=readManifest();
  mutate(manifest);
  assert.throws(() => validateManifest(manifest),expected);
});
test('binding availability and target are enforced',() => {
  const {manifest,invocation,binding} = fresh();
  assert.throws(() => validateInvocation(manifest,invocation,{...binding,available:false},{now}),/Binding unavailable/);
  assert.throws(() => validateInvocation(manifest,invocation,{...binding,target:'other'},{now}),/Target mismatch/);
});
test('receipt distinguishes view acknowledgement from operation outcome and rejects values',() => {
  const receipt={kind:'receipt',version:1,invocationId:'a',action:'vaultix.ui.secrets.reference.load',state:'unknown',
    viewAcknowledged:true,operationId:null,error:'Response lost; reconcile before retry.'};
  assert.equal(validateRecord(receipt).state,'unknown');
  assert.throws(() => validateRecord({...receipt,secretValue:'synthetic-canary'}),/Invalid UI record/);
});
test('actual CLI rejects a reduced ledger without editing the canonical baseline',() => {
  const directory=mkdtempSync(join(tmpdir(),'vaultix-ui-contract-'));
  const path=join(directory,'reduced.json');
  try {
    const manifest=readManifest(); manifest.actions.splice(0,1);
    writeFileSync(path,JSON.stringify(manifest));
    const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/check-ui-action-standard.mjs','--manifest',path],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Reference command coverage mismatch/);
    assert.equal(readManifest().actions.length,16);
  } finally { unlinkSync(path); rmdirSync(directory); }
});
