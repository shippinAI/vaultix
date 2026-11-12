// Independent public fixture producer. Run explicitly with Node; never imports
// the Go implementation or real configuration. Review fixture changes separately.
import {createHmac} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const secret=Buffer.alloc(32,0x31),resource='https://device.example.test';
const derive=kind=>createHmac('sha256',secret).update(`vaultix.device-credential.v1\0${kind}\0${resource}\0vaultix-cli\0vaultix:user`).digest();
const accessKey=derive('access'),refreshKey=derive('refresh');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const base={iss:resource,sub:'11111111-1111-4111-8111-111111111111',aud:[resource],iat:1800000000,exp:1800000600,
 userId:'11111111-1111-4111-8111-111111111111',tokenVersionId:'22222222-2222-4222-8222-222222222222',
 organizationId:'33333333-3333-4333-8333-333333333333',subOrganizationId:'33333333-3333-4333-8333-333333333333',
 accessVersion:1,authMethod:'email',isMfaVerified:false,authTokenType:'vaultix-device-access-v1',client_id:'vaultix-cli',scope:'vaultix:user'};
const sign=(payload,header={alg:'HS256',typ:'vaultix-device-at+jwt'},key=accessKey)=>{
 const body=encode(header)+'.'+encode(payload);
 return body+'.'+createHmac(header.alg==='HS512'?'sha512':'sha256',key).update(body).digest('base64url');
};
const access=[];
for(const method of ['email','google','github','gitlab','ldap','oidc','azure-saml','okta-saml','jumpcloud-saml','google-saml','keycloak-saml'])access.push({name:method,valid:true,token:sign({...base,authMethod:method})});
for(const method of ['email','totp','webauthn'])access.push({name:'mfa-'+method,valid:true,token:sign({...base,isMfaVerified:true,mfaMethod:method})});
for(const [name,changes] of Object.entries({
 issuer:{iss:'https://other.example.test'},audience:{aud:['https://other.example.test']},'multiple-audience':{aud:[resource,'https://other.example.test']},
 'missing-exp':{exp:undefined},expired:{exp:1800000000},'long-lifetime':{exp:1800086401},'future-issued':{iat:1800000001},'missing-issued':{iat:undefined},
 'not-before':{nbf:1800000000},subject:{sub:'44444444-4444-4444-8444-444444444444'},client:{client_id:'other-cli'},scope:{scope:'vaultix:admin'},
 'browser-type':{authTokenType:'accessToken'},'missing-type':{authTokenType:undefined},'missing-session':{tokenVersionId:undefined},'zero-user':{userId:'00000000-0000-0000-0000-000000000000'},
 'missing-version':{accessVersion:undefined},'negative-version':{accessVersion:-1},'overflow-version':{accessVersion:2147483648},'unknown-method':{authMethod:'unverified'},
 'missing-root':{organizationId:undefined},'missing-org':{subOrganizationId:undefined},'mfa-without-method':{isMfaVerified:true},'method-without-mfa':{mfaMethod:'totp'},
 'unknown-factor':{isMfaVerified:true,mfaMethod:'unverified'},'delegated-null':{oauthClientId:null},'delegated-client':{oauthClientId:'client'},'mcp-null':{mcp:null}
}))access.push({name,valid:false,token:sign({...base,...changes})});
access.push({name:'legacy-signing-key',valid:false,token:sign(base,undefined,secret)});
access.push({name:'refresh-signing-key',valid:false,token:sign(base,undefined,refreshKey)});
for(const [name,header] of Object.entries({'wrong-alg':{alg:'HS512',typ:'vaultix-device-at+jwt'},'wrong-media':{alg:'HS256',typ:'JWT'},'missing-media':{alg:'HS256'},'unknown-critical':{alg:'HS256',typ:'vaultix-device-at+jwt',crit:['future']}}))access.push({name,valid:false,token:sign(base,header)});
const refresh=[];
function refreshToken(generation,kind='valid') {
 const raw=Buffer.alloc(72,0x61);
 Buffer.from(base.userId.replaceAll('-',''),'hex').copy(raw,0);
 Buffer.from(base.tokenVersionId.replaceAll('-',''),'hex').copy(raw,16);
 raw.writeBigUInt64BE(BigInt(generation),32);
 if(kind==='zero-user')raw.fill(0,0,16);
 if(kind==='zero-session')raw.fill(0,16,32);
 return 'vxd1.'+Buffer.concat([raw,createHmac('sha256',refreshKey).update(raw).digest()]).toString('base64url');
}
for(const [name,generation,valid] of [['first',1,true],['rotated',7,true],['max',2147483647,true],['zero',0,false],['overflow',2147483648,false],['uint-overflow',18446744073709551615n,false]])refresh.push({name,valid,generation:valid?generation:0,token:refreshToken(generation)});
for(const name of ['zero-user','zero-session'])refresh.push({name,valid:false,generation:0,token:refreshToken(1,name)});
writeFileSync(new URL('./credentials-v1.json',import.meta.url),JSON.stringify({provenance:'Public independent Node crypto fixtures; fixed test material only.',secret:secret.toString('base64'),accessVerificationKey:accessKey.toString('base64'),refreshVerificationKey:refreshKey.toString('base64'),resource,now:base.iat,identity:base,access,refresh},null,2)+'\n');
