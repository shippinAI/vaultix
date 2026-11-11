import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {resolve,join} from 'node:path';

// Compile the real configuration consumer. Only logging is silenced so fixture
// credentials cannot enter test output; Client, TLS, filters and operations are real.
export async function ldapConfigurationConsumer() {
  const backend=resolve('core/backend');
  const require=createRequire(join(backend,'package.json'));
  const {build}=require('esbuild');
  const cache=join(backend,'node_modules/.cache');mkdirSync(cache,{recursive:true});
  const directory=mkdtempSync(join(cache,'vaultix-ldap-'));
  const output=join(directory,'consumer.cjs');
  try {
    const result=await build({stdin:{contents:`export {testLDAPConfig,searchGroups} from './src/services/ldap-config/ldap-fns';
      export {buildReferralUrl,isLdapReferralError} from './src/services/app-connection/ldap/ldap-connection-fns';`,resolveDir:backend,loader:'ts'},
      absWorkingDir:backend,bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
      plugins:[{name:'fixture-log-sink',setup(builder){
        builder.onResolve({filter:/^(?:@app\/lib\/logger|\.\.\/logger)$/},()=>({path:'logger',namespace:'fixture'}));
        builder.onLoad({filter:/^logger$/,namespace:'fixture'},()=>({contents:'export const logger = {error(){}};'}));
        // Pure referral policy checks do not open app connections. Fail loudly if
        // an unrelated configuration, target validator or gateway seam is invoked.
        const seams={'@app/lib/config/env':'getConfig','@app/lib/validator':'blockLocalAndPrivateIpAddresses','@app/lib/gateway-v2/gateway-v2':'withGatewayV2Proxy'};
        builder.onResolve({filter:/^@app\/lib\/(config\/env|validator|gateway-v2\/gateway-v2)$/},args=>({path:seams[args.path],namespace:'unused-seam'}));
        builder.onLoad({filter:/.*/,namespace:'unused-seam'},args=>({contents:`export function ${args.path}(){throw new Error('Unexpected unrelated fixture seam');}`}));
      }}]});
    writeFileSync(output,result.outputFiles[0].contents);
    return require(output);
  } finally {if(require.cache[output])delete require.cache[output];try{unlinkSync(output);}catch(error){if(error.code!=='ENOENT')throw error;}rmdirSync(directory);}
}
