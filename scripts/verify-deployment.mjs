// Run only against your deployment. The owner key is read from a private file,
// never printed. This creates an OAuth test client/grant and calls read-only MCP methods.
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]).origin;
assert.equal(new URL(origin).protocol,'https:');
const ownerKey=(await readFile(process.argv[3],'utf8')).trim();
assert.ok(ownerKey.length>=24,'Owner key is missing or too short');
const send=(path,init={})=>fetch(origin+path,{...init,redirect:'manual',signal:AbortSignal.timeout(30000)});
const jsonPost=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const formPost=body=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
const health=await send('/health');assert.equal(health.status,200);const healthData=await health.json();assert.equal(healthData.ok,true);
const unauth=await send('/mcp',{method:'POST'});assert.equal(unauth.status,401);assert.ok(unauth.headers.get('www-authenticate')?.includes('resource_metadata'));
const metadataResponse=await send('/.well-known/oauth-authorization-server');assert.equal(metadataResponse.status,200);const metadata=await metadataResponse.json();
const resourceResponse=await send('/.well-known/oauth-protected-resource');assert.equal(resourceResponse.status,200);assert.equal((await resourceResponse.json()).resource,origin+'/mcp');
const callback='https://example.com/ghostwriter-verification';
const registered=await send('/oauth/register',jsonPost({client_name:'Ghostwriter deployment verification',redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}));assert.equal(registered.status,201);const client=await registered.json();
const verifier=randomBytes(48).toString('base64url');const state=randomBytes(24).toString('base64url');
const query=new URLSearchParams({client_id:client.client_id,redirect_uri:callback,response_type:'code',scope:'ghostwriter',resource:origin+'/mcp',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
const consent=await send('/authorize?'+query);assert.equal(consent.status,200);const html=await consent.text();const nonce=html.match(/name="nonce" value="([^"]+)"/)?.[1];assert.ok(nonce);
const cookie=consent.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
const approval=formPost({nonce,owner_key:ownerKey});approval.headers={...approval.headers,origin,cookie};
const approved=await send('/authorize',approval);assert.equal(approved.status,302);const redirect=new URL(approved.headers.get('location'));assert.equal(redirect.origin,new URL(callback).origin);assert.equal(redirect.searchParams.get('state'),state);
const tokenResponse=await send('/oauth/token',formPost({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:callback,code:redirect.searchParams.get('code'),code_verifier:verifier,resource:origin+'/mcp'}));assert.equal(tokenResponse.status,200);const token=await tokenResponse.json();assert.ok(token.access_token);
async function rpc(method,params={}) {
  const response=await send('/mcp',{...jsonPost({jsonrpc:'2.0',id:1,method,params}),headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${token.access_token}`}});assert.equal(response.status,200);const raw=await response.text();const data=JSON.parse(raw.startsWith('{')?raw:raw.split('\n').find(l=>l.startsWith('data:')).slice(5));assert.ok(data.result,`MCP ${method} failed`);return data.result;
}
const initialized=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'deployment-verifier',version:'1'}});assert.equal(initialized.serverInfo.name,'ghostwriter');
const listed=await rpc('tools/list');assert.equal(listed.tools.length,healthData.imageStorageEnabled?11:10);assert.equal(listed.tools.some(t=>t.name==='generate_images'),healthData.imageStorageEnabled);
// Revoke the verification grant when the provider advertises an endpoint.
if(metadata.revocation_endpoint) {
  const endpoint=new URL(metadata.revocation_endpoint);assert.equal(endpoint.origin,origin);
  const revoked=await send(endpoint.pathname,formPost({token:token.refresh_token??token.access_token,client_id:client.client_id}));assert.equal(revoked.status,200);
}
console.log(JSON.stringify({verified:true,workerUrl:origin,mcpUrl:origin+'/mcp',health:true,oauth:true,initialize:true,tools:listed.tools.map(t=>t.name)},null,2));
