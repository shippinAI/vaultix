// Deliberate publication after visual review; source and media must match the render receipt.
import assert from 'node:assert/strict';
import {readFileSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {frontendTree,sha256} from './source-provenance.mjs';
const root=process.cwd();
assert.equal(process.argv[2],'--reviewed','Review the recorded frames and workflow before publication');
const {output,receipt}=JSON.parse(readFileSync('.cache/recorded-media-latest.json'));
const render=JSON.parse(readFileSync(receipt));assert.equal(render.passed,true);
for(const file of render.frontend)assert.equal(sha256(readFileSync(file.path)),file.sha256,`Changed recording source: ${file.path}`);
const recording=JSON.parse(readFileSync(render.recording));assert.equal(recording.passed,true);assert.equal(recording.cleanupPassed,true);
const destination=resolve(root,'core/frontend/public/media');mkdirSync(destination,{recursive:true});
for(const file of render.files){assert.equal(sha256(readFileSync(resolve(output,file.name))),file.sha256);copyFileSync(resolve(output,file.name),resolve(destination,file.name));}
const manifest={schemaVersion:'vaultix.public-recording.v1',remotion:render.remotion,backend:recording.backend,frontend:frontendTree(root),rawSha256:render.raw.sha256,recordingManifestHash:render.recordingManifestHash,renderSources:['core/media/src/recorded.tsx','core/media/render-recorded.mjs','core/media/recorded-story.mjs'].map(path=>({path,sha256:sha256(readFileSync(path,'utf8').replaceAll('\r\n','\n'))})),durationSeconds:render.metadata.durationInSeconds,width:1600,height:900,fps:30,files:render.files,scope:recording.scope,credentialsRecorded:false,chapters:render.edit.chapters};
writeFileSync(resolve(destination,'vaultix-tour.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({published:render.files,frontend:manifest.frontend}));
