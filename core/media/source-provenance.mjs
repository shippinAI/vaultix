import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function frontendTree(root){
  const files=[];
  function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())walk(path);else{
    const data=readFileSync(path);
    files.push({path:relative(root,path).replaceAll('\\','/'),sha256:sha256(/\.(tsx?|css|js|json)$/.test(path)?data.toString('utf8').replaceAll('\r\n','\n'):data)});
  }}}
  walk(resolve(root,'core/frontend/src'));
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {algorithm:'sha256-path-content-lf-v1',files:files.length,sha256:sha256(JSON.stringify(files))};
}
