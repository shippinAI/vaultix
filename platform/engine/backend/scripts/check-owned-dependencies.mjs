import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const legacy = /infisical/i;
export function assertOwnedManifest(manifest, publishedDependency = false) {
  if (typeof manifest.name !== 'string' || legacy.test(manifest.name)) throw new Error('Dependency has a forbidden product name.');
  for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies','overrides']) {
    const visit = value => {
      if(typeof value==='string' && ((!publishedDependency && value.startsWith('npm:')) || legacy.test(value))) throw new Error('Aliased or forbidden product dependency.');
      if(value && typeof value==='object') for(const [name,child] of Object.entries(value)) {
        if(legacy.test(name)) throw new Error('Forbidden product dependency name.');
        visit(child);
      }
    };
    visit(manifest[field]);
  }
}
export async function checkOwnedDependencies(root) {
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assertOwnedManifest(manifest);
  const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
  if(lock.lockfileVersion!==3 || !lock.packages) throw new Error('Expected a complete version 3 lockfile.');
  for(const [path,entry] of Object.entries(lock.packages)) {
    if(legacy.test(path) || legacy.test(entry.resolved ?? '') || legacy.test(entry.name ?? '')) throw new Error('Forbidden product package in dependency lock.');
    // Published utility packages may use CJS compatibility dependency names.
    // Product manifests cannot alias packages, and no graph may contain the old product.
    assertOwnedManifest({...entry,name:entry.name ?? path ?? manifest.name},path !== '');
  }
  let installed=0;
  async function scan(directory) {
    for(const item of await readdir(directory,{withFileTypes:true})) {
      if(!item.isDirectory() || item.name.startsWith('.'))continue;
      const path=join(directory,item.name);
      if(item.name.startsWith('@')) {await scan(path);continue;}
      let pkg;
      try {pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8'));}
      catch(error) {if(error.code==='ENOENT')continue;throw error;}
      if(legacy.test(pkg.name ?? '') || legacy.test(path)) throw new Error('Forbidden product package remains installed.');
      installed++;
      try {await scan(join(path,'node_modules'));} catch(error) {if(error.code!=='ENOENT')throw error;}
    }
  }
  await scan(join(root,'node_modules'));
  if(!installed)throw new Error('No installed dependencies to verify.');
  return {installed,locked:Object.keys(lock.packages).length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({passed:true,...await checkOwnedDependencies(resolve(fileURLToPath(new URL('..',import.meta.url))))}));
}
