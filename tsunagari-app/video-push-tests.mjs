import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createPublicKey,verify} from 'node:crypto';
import worker from './dist/server/index.js';
import {createEnv} from './local-adapter.mjs';
import {createStorage} from './node-storage.mjs';
import {validateVideo} from './video-media.mjs';
import {validPushEndpoint} from './push-api.mjs';
import {createPushService,loadPushKey,vapidHeader} from './node-push.mjs';

function mp4(seconds=2){
 const box=(type,...parts)=>{const body=Buffer.concat(parts),header=Buffer.alloc(8);header.writeUInt32BE(body.length+8);header.write(type,4);return Buffer.concat([header,body])};
 const mvhd=Buffer.alloc(100);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(seconds*1000,16);const hdlr=Buffer.alloc(24);hdlr.write('vide',8);
 return Buffer.concat([box('ftyp',Buffer.from('isom'),Buffer.alloc(4),Buffer.from('isommp42')),box('moov',box('mvhd',mvhd),box('trak',box('mdia',box('hdlr',hdlr)))),box('mdat',Buffer.from([1,2,3,4]))]);
}
function harness(env){
 env.ADMIN_SETUP_TOKEN='video-and-push-bootstrap-secret-32-characters';let seq=0;
 async function req(url,{cookie='',method='GET',body,headers={},origin='https://sns.test'}={}){
  headers={origin,cookie,'cf-connecting-ip':'192.0.2.'+(++seq),...headers};if(body!==undefined&&!(body instanceof FormData)){headers['content-type']='application/json';body=JSON.stringify(body)}
  return worker.fetch(new Request('https://sns.test'+url,{method,headers,body}),env);
 }
 const cookie=r=>r.headers.get('set-cookie')?.split(';')[0];
 async function users(){
  const a=await req('/api/auth/register',{method:'POST',body:{username:'admin',name:'Admin',password:'video-push-password',code:env.ADMIN_SETUP_TOKEN}});assert.equal(a.status,201);
  const admin=cookie(a),invite=await(await req('/api/admin/invites',{cookie:admin,method:'POST',body:{username:'member'}})).json();
  const m=await req('/api/auth/register',{method:'POST',body:{username:'member',name:'Member',password:'video-push-password',code:invite.code}});assert.equal(m.status,201);return {a:admin,b:cookie(m)};
 }
 return {req,users};
}
test('MP4 validation, private playback, range seeking, attachment limits and deletion',async()=>{
 const env=createEnv(),{req,users}=harness(env);
 try{
  const {a,b}=await users(),bytes=mp4();assert.equal(validateVideo(bytes).ext,'mp4');assert.equal(validateVideo(mp4(60)).ext,'mp4');
  assert.match((await req('/')).headers.get('content-security-policy'),/media-src 'self' blob:/);
  for(const bytes of [mp4(61),mp4(0),Buffer.from('<svg>'),Buffer.alloc(20000001),mp4().subarray(0,50)])assert.throws(()=>validateVideo(bytes));
  const form=()=>{const f=new FormData();f.set('video',new File([bytes],'clip.mp4',{type:'video/mp4'}));return f};
  assert.equal((await req('/api/posts',{method:'POST',body:form()})).status,401);
  let f=form();f.append('images',new File([fs.readFileSync('public/icon-192.png')],'a.png',{type:'image/png'}));assert.equal((await req('/api/posts',{method:'POST',cookie:a,body:f})).status,400);
  f=form();f.append('video',new File([bytes],'two.mp4'));assert.equal((await req('/api/posts',{method:'POST',cookie:a,body:f})).status,400);
  f=new FormData();f.set('video',new File([mp4(61)],'long.mp4'));assert.equal((await req('/api/posts',{method:'POST',cookie:a,body:f})).status,400);
  const created=await req('/api/posts',{method:'POST',cookie:a,body:form()});assert.equal(created.status,201);const {id}=await created.json();
  const list=await(await req('/api/posts',{cookie:b})).json(),media='/media/'+list.posts[0].images[0];assert.ok(media.endsWith('.mp4'));
  assert.equal((await(await req('/api/posts?mode=images',{cookie:b})).json()).posts.length,0);
  assert.equal((await req(media)).status,401);assert.equal((await req(media,{method:'HEAD'})).status,401);
  let result=await req(media,{cookie:b});assert.equal(result.headers.get('content-type'),'video/mp4');assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
  result=await req(media,{cookie:b,headers:{range:'bytes=4-11'}});assert.equal(result.status,206);assert.equal(result.headers.get('content-range'),`bytes 4-11/${bytes.length}`);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes.subarray(4,12));
  result=await req(media,{cookie:b,headers:{range:'bytes=-4'}});assert.equal(result.status,206);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes.subarray(-4));
  assert.equal((await req(media,{cookie:b,headers:{range:'bytes=99999-'}})).status,416);
  assert.equal((await req(media,{cookie:b,method:'HEAD'})).headers.get('content-length'),String(bytes.length));
  assert.equal((await worker.fetch(new Request('https://sns.test'+media,{method:'HEAD',headers:{cookie:b}}),env)).status,200);
  assert.equal((await req('/api/posts/'+id,{cookie:b,method:'DELETE'})).status,403);
  assert.equal((await req('/api/posts/'+id,{cookie:a,method:'DELETE'})).status,200);assert.equal((await req(media,{cookie:b})).status,404);assert.equal(env.files.size,0);
 }finally{env.sqlite.close()}
});

test('push preferences, triggers, session invalidation, durable keys, retries and VAPID',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsunagari-push-'));let env,push;
 try{
  env=createStorage(dir);const sent=[];let sendStatus=201;
  const send=async(url,options)=>{sent.push({url,options});return new Response(null,{status:sendStatus})};
  push=createPushService({env,directory:dir,origin:'https://sns.test',send,intervalMs:999999});env.PUSH=push;
  const {req,users}=harness(env),{a,b}=await users();
  const endpoints={a:'https://web.push.apple.com/test-admin',b:'https://fcm.googleapis.com/test-member'};
  const subscribe=(cookie,endpoint)=>req('/api/push/subscription',{cookie,method:'POST',body:{endpoint}});
  assert.equal((await req('/api/push/config')).status,401);
  for(const url of ['http://127.0.0.1','https://web.push.apple.com.evil.test/a','https://user@web.push.apple.com/a','https://web.push.apple.com:8443/a','https://fcm.googleapis.com/a#x','https://localhost/a']){assert.equal(validPushEndpoint(url),false);assert.equal((await subscribe(a,url)).status,400)}
  assert.equal((await subscribe(a,endpoints.a)).status,200);assert.equal((await subscribe(b,endpoints.b)).status,200);
  assert.equal((await(await req('/api/push/config',{cookie:a})).json()).subscribed,true);
  assert.equal((await req('/api/push/subscription',{cookie:a,method:'DELETE',origin:'https://other.test',body:{endpoint:endpoints.a}})).status,403);
  const f=new FormData();f.set('body','New post');const post=await(await req('/api/posts',{cookie:a,method:'POST',body:f})).json();
  await push.drain();assert.deepEqual(sent.map(s=>s.url),[endpoints.b]);assert.equal(sent[0].options.body.length,0);assert.equal(sent[0].options.redirect,'error');
  assert.equal((await req(`/api/posts/${post.id}/comments`,{cookie:b,method:'POST',body:{body:'reply'}})).status,201);await push.drain();assert.equal(sent.at(-1).url,endpoints.a);
  assert.equal((await req('/api/announcement',{cookie:a,method:'PUT',body:{body:'連絡'}})).status,200);await push.drain();assert.equal(sent.at(-1).url,endpoints.b);
  const cached=sent[0].options.headers.Authorization;assert.equal(sent.at(-1).options.headers.Authorization,cached);
  const sendTest=(cookie,endpoint)=>req('/api/push/test',{cookie,method:'POST',body:{endpoint}});
  let count=sent.length;
  assert.equal((await(await sendTest(a,endpoints.b)).json()).reason,'unregistered');assert.equal(sent.length,count);
  const other=await req('/api/auth/login',{method:'POST',body:{username:'admin',password:'video-push-password'}});
  assert.equal(other.status,200);
  assert.equal((await(await sendTest(other.headers.get('set-cookie').split(';')[0],endpoints.a)).json()).reason,'unregistered');assert.equal(sent.length,count);
  assert.equal((await(await sendTest(a,endpoints.a)).json()).accepted,true);assert.equal(sent.at(-1).url,endpoints.a);assert.equal(sent.at(-1).options.headers.Urgency,'high');
  for(const [status,reason] of [[403,'authorization'],[429,'limited'],[503,'provider'],[410,'expired']]){sendStatus=status;const result=await(await sendTest(a,endpoints.a)).json();assert.deepEqual(result,{accepted:false,status,reason})}
  assert.equal((await(await req('/api/push/config',{cookie:a})).json()).subscribed,false);
  await subscribe(a,endpoints.a);sendStatus=201;
  const key=loadPushKey(dir),header=vapidHeader(key,endpoints.a,'https://sns.test',1700000000000),jwt=header.match(/t=([^,]+)/)[1],parts=jwt.split('.');
  assert.equal(parts.length,3);assert.equal(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key:createPublicKey(key.privateKey),dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),true);
  assert.deepEqual(JSON.parse(Buffer.from(parts[1],'base64url')),{aud:'https://web.push.apple.com',exp:1700043200,sub:'https://sns.test/'});
  assert.equal(loadPushKey(dir).publicKey,key.publicKey);
  const before=sent.length;await push.enqueue();assert.equal((await req('/api/auth/logout',{cookie:b,method:'POST'})).status,200);await push.drain();assert.equal(sent.length,before+1);assert.equal(sent.at(-1).url,endpoints.a);
  await push.enqueue();sendStatus=503;await push.drain();assert.equal((await env.DB.prepare('SELECT attempts FROM push_jobs LIMIT 1').first()).attempts,1);
  await env.DB.prepare('UPDATE push_jobs SET available=0').run();sendStatus=410;await push.drain();assert.equal((await(await req('/api/push/config',{cookie:a})).json()).subscribed,false);
  // Video bytes and VAPID keys persist independently of the running process.
  await env.BUCKET.put('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/0.mp4',mp4());await push.close();push=null;env.close();env=createStorage(dir);
  assert.equal((await env.BUCKET.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/0.mp4')).httpMetadata.contentType,'video/mp4');assert.equal(loadPushKey(dir).publicKey,key.publicKey);
 }finally{await push?.close();env?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true})}
});

test('service worker shows a generic notification without requiring the SNS to be open',async()=>{
 const listeners={},shown=[];let opened='';const self={addEventListener:(name,handler)=>listeners[name]=handler,registration:{showNotification:async(title,options)=>shown.push({title,options})},location:{origin:'https://sns.test'},clients:{matchAll:async()=>[],openWindow:async url=>{opened=url}}};
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self,URL,fetch,Response});let work;
 listeners.push({waitUntil:p=>work=p});await work;assert.equal(shown[0].title,'つながり');assert.match(shown[0].options.body,/新しい投稿/);
 let closed=false;listeners.notificationclick({notification:{close:()=>closed=true},waitUntil:p=>work=p});await work;assert.equal(closed,true);assert.equal(opened,'https://sns.test/');
});

test('notification UI asks permission only after a tap and registers/offlines the current endpoint',async()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{disabled:false,textContent:'',open:false,showModal(){this.open=true},close(){this.open=false}});return elements.get(id)};
 let permissionCalls=0,sub=null,enabled=false;const calls=[];
 const subscription={endpoint:'https://web.push.apple.com/test',options:{},toJSON(){return {keys:{p256dh:'test-public-key',auth:'test-auth'}}},async unsubscribe(){sub=null}};
 const pushManager={async getSubscription(){return sub},async subscribe(options){assert.equal(options.userVisibleOnly,true);sub=subscription;return sub}};
 const context={$ ,me:{id:'user'},isSecureContext:true,Uint8Array,atob,setTimeout:()=>1,toast(){},Notification:{permission:'default',async requestPermission(){permissionCalls++;this.permission='granted';return 'granted'}},navigator:{userAgent:'iPhone',standalone:false,serviceWorker:{ready:Promise.resolve({pushManager})}},window:{PushManager:{},Notification:{},matchMedia:()=>({matches:false})},api:async(url,options)=>{calls.push({url,options});if(url==='/api/push/config')return {available:true,publicKey:Buffer.alloc(65,1).toString('base64url'),subscribed:enabled,endpoints:enabled?[subscription.endpoint]:[],detailEndpoints:enabled?[subscription.endpoint]:[]};if(url==='/api/push/test')return {accepted:true,status:201};enabled=options.method==='POST';return {ok:true}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/notifications.js','utf8'),context);
 await $('#open-notifications').onclick();assert.match($('#notification-status').textContent,/ホーム画面/);assert.equal(calls.length,0);
 context.navigator.standalone=true;await $('#open-notifications').onclick();assert.equal(permissionCalls,0);assert.equal($('#notification-enable').disabled,false);
 await $('#notification-enable').onclick();assert.equal(permissionCalls,1);assert.equal(enabled,true);assert.equal($('#notification-test').disabled,false);assert.match($('#notification-status').textContent,/オン/);
 await $('#notification-test').onclick();assert.match($('#notification-status').textContent,/端末への表示はまだ確認できていません/);assert.equal(JSON.parse(calls.at(-1).options.body).endpoint,subscription.endpoint);
 await $('#notification-repair').onclick();assert.equal(enabled,true);assert.equal($('#notification-test').disabled,false);
 await $('#notification-disable').onclick();assert.equal(enabled,false);assert.equal(sub,null);assert.match($('#notification-status').textContent,/オフ/);
});
