import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,createPrivateKey,createPublicKey,sign,randomUUID} from 'node:crypto';
import {validPushEndpoint} from './push-api.mjs';
import {encryptPush} from './push-encryption.mjs';

export function loadPushKey(directory){
 const file=path.resolve(directory,'push-keys.json');
 if(!fs.existsSync(file)){
  const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  fs.writeFileSync(file,JSON.stringify(privateKey.export({format:'jwk'})),{flag:'wx',mode:0o600});
 }
 const privateKey=createPrivateKey({key:JSON.parse(fs.readFileSync(file,'utf8')),format:'jwk'}),pub=createPublicKey(privateKey).export({format:'jwk'});
 if(pub.crv!=='P-256')throw Error('Unsupported push key');
 return {privateKey,publicKey:Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url')};
}
export function vapidHeader(key,endpoint,origin,now=Date.now()){
 if(!validPushEndpoint(endpoint))throw Error('Invalid push destination');
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const value=encode({typ:'JWT',alg:'ES256'})+'.'+encode({aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+43200,sub:origin+'/'});
 const signature=sign('sha256',Buffer.from(value),{key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 return `vapid t=${value}.${signature}, k=${key.publicKey}`;
}
export function createPushService({env,directory,origin,send=fetch,intervalMs=2000}){
 const key=loadPushKey(directory),db=env.DB;let closing=false,running=null;const controller=new AbortController();
 const cacheFile=path.resolve(directory,'push-authorization.json');let cache={};
 try{cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'))}catch{/* first run */}
 function authorization(endpoint){
  const audience=new URL(endpoint).origin,now=Date.now(),cached=cache[audience];
  if(cached&&cached.publicKey===key.publicKey&&cached.origin===origin&&cached.created<=now&&now-cached.created<3600000&&typeof cached.header==='string')return cached.header;
  const header=vapidHeader(key,endpoint,origin,now);cache[audience]={header,created:now,publicKey:key.publicKey,origin};
  fs.writeFileSync(cacheFile,JSON.stringify(cache),{mode:0o600});return header;
 }
 async function sendNotification(endpoint,subscription,payload=''){
  if(closing||!validPushEndpoint(endpoint))return 0;
  let status=0;
  try{
   const detailed=!!(payload&&subscription?.p256dh&&subscription?.auth);
   const body=detailed?encryptPush(payload,subscription):new Uint8Array(0);
   const headers={Authorization:authorization(endpoint),TTL:'300',Urgency:'high'};
   if(detailed){headers['Content-Encoding']='aes128gcm';headers['Content-Type']='application/octet-stream'}
   const result=await send(endpoint,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});status=result.status;await result.body?.cancel()
  }catch{/* Do not expose endpoints, authorization or provider response bodies. */}
  return status;
 }
 async function test({userId,sessionHash,endpoint,payload}){
  const live=await db.prepare('SELECT p.endpoint,p.p256dh,p.auth FROM push_subscriptions p JOIN accounts a ON a.user_id=p.user_id JOIN sessions s ON s.token_hash=p.session_hash WHERE p.endpoint=? AND p.user_id=? AND p.session_hash=? AND a.enabled=1 AND s.expires>?').bind(endpoint,userId,sessionHash,Date.now()).first();
  if(!live)return {accepted:false,reason:'unregistered',status:0};
  const status=await sendNotification(endpoint,live,payload?JSON.stringify(payload):'');
  if(status===404||status===410)await db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=? AND session_hash=?').bind(endpoint,userId,sessionHash).run();
  const accepted=status>=200&&status<300;
  return {accepted,status,reason:accepted?'accepted':status===404||status===410?'expired':status===401||status===403?'authorization':status===429?'limited':status===0?'network':'provider'};
 }
 async function enqueue({excludeUser='',onlyUser='',sessionHash='',payload}={}){
  const now=Date.now();
  const encoded=payload?JSON.stringify(payload):'';
  if(Buffer.byteLength(encoded)>3993)throw Error('Push payload too large');
  await db.prepare('DELETE FROM push_jobs WHERE created<?').bind(now-300000).run();
  const subscriptions=await db.prepare('SELECT p.endpoint FROM push_subscriptions p JOIN accounts a ON a.user_id=p.user_id JOIN sessions s ON s.token_hash=p.session_hash WHERE a.enabled=1 AND s.expires>? AND p.user_id<>? AND (?=\'\' OR p.user_id=?) AND (?=\'\' OR p.session_hash=?)').bind(now,excludeUser,onlyUser,onlyUser,sessionHash,sessionHash).all();
  for(const row of subscriptions.results)await db.prepare('INSERT INTO push_jobs(id,endpoint,created,available,payload) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM push_jobs)<2000').bind(randomUUID(),row.endpoint,now,now,encoded).run();
 }
 async function deliver(){
  const now=Date.now();
  await db.prepare('DELETE FROM push_jobs WHERE created<? OR NOT EXISTS (SELECT 1 FROM push_subscriptions p JOIN accounts a ON a.user_id=p.user_id JOIN sessions s ON s.token_hash=p.session_hash WHERE p.endpoint=push_jobs.endpoint AND a.enabled=1 AND s.expires>?)').bind(now-300000,now).run();
  const jobs=await db.prepare('SELECT id,endpoint,attempts,payload FROM push_jobs WHERE available<=? ORDER BY created LIMIT 5').bind(now).all();
  for(const job of jobs.results){
   if(closing)return;
   // Recheck sessions immediately before sending (logout/disable may occur while queued).
   const live=await db.prepare('SELECT p.endpoint,p.p256dh,p.auth FROM push_subscriptions p JOIN accounts a ON a.user_id=p.user_id JOIN sessions s ON s.token_hash=p.session_hash WHERE p.endpoint=? AND a.enabled=1 AND s.expires>?').bind(job.endpoint,Date.now()).first();
   if(!live){await db.prepare('DELETE FROM push_jobs WHERE id=?').bind(job.id).run();continue}
   const status=await sendNotification(job.endpoint,live,job.payload);
   if(closing)return;
   if(status===404||status===410)await db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(job.endpoint).run();
   if((status>=200&&status<300)||(status>=400&&status<500&&status!==429)||job.attempts>=2)await db.prepare('DELETE FROM push_jobs WHERE id=?').bind(job.id).run();
   else await db.prepare('UPDATE push_jobs SET attempts=attempts+1,available=? WHERE id=?').bind(Date.now()+15000*(job.attempts+1),job.id).run();
  }
 }
 function drain(){if(closing)return Promise.resolve();if(running)return running;running=deliver().catch(()=>console.error('Notification delivery could not complete.')).finally(()=>{running=null});return running}
 const timer=setInterval(()=>void drain(),intervalMs);timer.unref();
 return {publicKey:key.publicKey,enqueue,test,drain,async close(){closing=true;clearInterval(timer);controller.abort();if(running)await running}};
}
