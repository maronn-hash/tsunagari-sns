import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createECDH,createHmac,createDecipheriv,randomBytes} from 'node:crypto';
import {encryptPush} from './push-encryption.mjs';
import {pushPreview} from './push-api.mjs';
import {createStorage} from './node-storage.mjs';
import {createPushService} from './node-push.mjs';
import worker from './dist/server/index.js';

function receiver(){const ec=createECDH('prime256v1');ec.generateKeys();return {ec,keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}}
function decrypt(bytes,receiver){
 const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
 const expand=(key,info,n)=>hmac(key,Buffer.concat([Buffer.from(info),Buffer.from([1])])).subarray(0,n);
 assert.equal(bytes.readUInt32BE(16),4096);assert.equal(bytes[20],65);
 const server=bytes.subarray(21,86),secret=receiver.ec.computeSecret(server);
 const prkKey=hmac(Buffer.from(receiver.keys.auth,'base64url'),secret);
 const ikm=expand(prkKey,Buffer.concat([Buffer.from('WebPush: info\0'),receiver.ec.getPublicKey(),server]),32);
 const prk=hmac(bytes.subarray(0,16),ikm);
 const cipher=createDecipheriv('aes-128-gcm',expand(prk,'Content-Encoding: aes128gcm\0',16),expand(prk,'Content-Encoding: nonce\0',12));
 cipher.setAuthTag(bytes.subarray(-16));const plain=Buffer.concat([cipher.update(bytes.subarray(86,-16)),cipher.final()]);
 assert.equal(plain.at(-1),2);return plain.subarray(0,-1).toString('utf8');
}

test('Web Push encryption matches RFC 8291 section 5, randomizes messages and rejects tampering',()=>{
 // Public test vector from https://www.rfc-editor.org/rfc/rfc8291#section-5
 const keys={p256dh:'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',auth:'BTBZMqHH6r4Tts7J_aSIgg'};
 const plain='When I grow up, I want to be a watermelon';
 const bytes=encryptPush(plain,keys,{salt:Buffer.from('DGv6ra1nlYgDCS1FRnbzlw','base64url'),privateKey:Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw','base64url')});
 assert.equal(bytes.toString('base64url'),'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
 const user=receiver(),message=JSON.stringify(pushPreview({name:'花子',body:'こんにちは 🌸'.repeat(30)}));
 const a=encryptPush(message,user.keys),b=encryptPush(message,user.keys);assert.notDeepEqual(a,b);assert.equal(decrypt(a,user),message);assert.equal(decrypt(b,user),message);
 assert.equal(a.includes(Buffer.from('花子')),false);a[a.length-1]^=1;assert.throws(()=>decrypt(a,user));
 assert.throws(()=>encryptPush('a'.repeat(3994),user.keys));assert.throws(()=>encryptPush('x',{p256dh:Buffer.alloc(65,4).toString('base64url'),auth:user.keys.auth}));
});

test('notification content clips Unicode, identifies attachments and only links to SNS posts',()=>{
 const message=pushPreview({name:'花子',body:'🌸'.repeat(101),postId:'12345678-1234-1234-1234-123456789abc'});
 assert.equal(message.title,'花子さんが投稿しました');assert.equal(message.body,'🌸'.repeat(100)+'…');assert.match(message.url,/^\/\?post=/);
 assert.equal(pushPreview({images:['abc/0.mp4']}).body,'🎥 動画');assert.equal(pushPreview({images:['abc/0.png','abc/1.jpg']}).body,'📷 画像2枚');
 assert.equal(pushPreview({postId:'https://evil.example/'}).url,'/');
});

test('encrypted post, reply, announcement and test notifications preserve recipients, data and authentication',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsunagari-content-'));let env,push;
 try{
  // Upgrade the previous schema while preserving an existing profile and post.
  const {DatabaseSync}=await import('node:sqlite');const old=new DatabaseSync(path.join(dir,'sns.sqlite'));
  old.exec('CREATE TABLE _node_migrations(name TEXT PRIMARY KEY NOT NULL)');
  for(const name of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')&&x<'0006').sort()){old.exec(fs.readFileSync('drizzle/'+name,'utf8'));old.prepare('INSERT INTO _node_migrations VALUES (?)').run(name)}
  old.exec("INSERT INTO profiles(id,name) VALUES ('legacy-user','以前のメンバー'); INSERT INTO posts(id,author,body,category,images,created) VALUES ('legacy-post','legacy-user','更新前の投稿','日々のこと','[]',1)");old.close();
  env=createStorage(dir);env.ADMIN_SETUP_TOKEN='push-content-bootstrap-secret-with-32-characters';const sent=[];
  assert.equal((await env.DB.prepare("SELECT body FROM posts WHERE id='legacy-post'").first()).body,'更新前の投稿');
  push=createPushService({env,directory:dir,origin:'https://sns.test',intervalMs:999999,send:async(url,options)=>{sent.push({url,options});return new Response(null,{status:201})}});env.PUSH=push;
  let seq=0;const request=(url,{cookie='',method='GET',body}={})=>{const form=body instanceof FormData;return worker.fetch(new Request('https://sns.test'+url,{method,headers:{origin:'https://sns.test',cookie,'cf-connecting-ip':'192.0.2.'+(++seq),...(!form&&body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:form?body:JSON.stringify(body)}),env)};
  const cookie=r=>r.headers.get('set-cookie').split(';')[0];
  const admin=cookie(await request('/api/auth/register',{method:'POST',body:{username:'admin',name:'花子',password:'content-test-password',code:env.ADMIN_SETUP_TOKEN}}));
  const invite=await(await request('/api/admin/invites',{cookie:admin,method:'POST',body:{username:'member'}})).json();
  const member=cookie(await request('/api/auth/register',{method:'POST',body:{username:'member',name:'太郎',password:'content-test-password',code:invite.code}}));
  const a=receiver(),b=receiver(),endA='https://web.push.apple.com/admin',endB='https://fcm.googleapis.com/member',legacy='https://web.push.apple.com/legacy';
  const subscribe=(cookie,endpoint,keys)=>request('/api/push/subscription',{cookie,method:'POST',body:{endpoint,keys}});
  for(const keys of [{auth:b.keys.auth,p256dh:'bad'},null,{auth:'bad',p256dh:b.keys.p256dh},{auth:b.keys.auth,p256dh:Buffer.alloc(65,4).toString('base64url')}])assert.equal((await subscribe(member,endB,keys)).status,400);
  assert.equal((await subscribe(admin,endA,a.keys)).status,200);assert.equal((await subscribe(member,endB,b.keys)).status,200);assert.equal((await subscribe(member,legacy)).status,200);
  const config=await(await request('/api/push/config',{cookie:member})).json();assert.deepEqual(config.detailEndpoints,[endB]);assert.equal(JSON.stringify(config).includes(b.keys.auth),false);
  const form=new FormData();form.set('body','今日はありがとう 🌸');form.set('images',new File([fs.readFileSync('public/icon-192.png')],'a.png',{type:'image/png'}));
  const created=await request('/api/posts',{cookie:admin,method:'POST',body:form});assert.equal(created.status,201);const {id}=await created.json();
  await push.drain();assert.equal(sent.length,2);
  const modern=sent.find(s=>s.url===endB);assert.equal(modern.options.headers['Content-Encoding'],'aes128gcm');assert.equal(sent.find(s=>s.url===legacy).options.body.length,0);
  let message=JSON.parse(decrypt(modern.options.body,b));assert.equal(message.title,'花子さんが投稿しました');assert.equal(message.body,'今日はありがとう 🌸 📷 画像1枚');assert.equal(message.url,'/?post='+id);
  assert.equal((await request('/api/posts?post='+id)).status,401);
  const one=await(await request('/api/posts?post='+id,{cookie:member})).json();assert.equal(one.posts.length,1);assert.equal(one.posts[0].id,id);
  assert.equal((await request('/api/posts?post=invalid',{cookie:member})).status,404);
  await request('/api/posts/'+id+'/comments',{cookie:member,method:'POST',body:{body:'おつかれさま！'}});await push.drain();assert.equal(sent.at(-1).url,endA);message=JSON.parse(decrypt(sent.at(-1).options.body,a));assert.equal(message.title,'太郎さんが返信しました');assert.equal(message.body,'おつかれさま！');assert.equal(message.url,'/?post='+id);
  await request('/api/announcement',{cookie:admin,method:'PUT',body:{body:'明日はミーティングです'}});await push.drain();message=JSON.parse(decrypt(sent.filter(x=>x.url===endB).at(-1).options.body,b));assert.equal(message.title,'花子さんが固定コメントを更新');assert.equal(message.body,'明日はミーティングです');
  const result=await(await request('/api/push/test',{cookie:member,method:'POST',body:{endpoint:endB}})).json();assert.equal(result.accepted,true);message=JSON.parse(decrypt(sent.at(-1).options.body,b));assert.equal(message.title,'太郎さんのテスト通知');
  await push.close();push=null;env.close();env=createStorage(dir);assert.equal((await env.DB.prepare('SELECT p256dh FROM push_subscriptions WHERE endpoint=?').bind(endB).first()).p256dh,b.keys.p256dh);assert.equal((await env.DB.prepare('SELECT body FROM posts WHERE id=?').bind(id).first()).body,'今日はありがとう 🌸');
 }finally{await push?.close();env?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true})}
});

test('service worker displays decrypted content, follows post links and blocks external navigation',async()=>{
 const handlers={},shown=[];let opened='',work;
 const self={addEventListener:(name,f)=>handlers[name]=f,registration:{showNotification:async(title,options)=>shown.push({title,options})},location:{origin:'https://sns.test'},clients:{matchAll:async()=>[],openWindow:async url=>opened=url}};
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self,URL,fetch,Response});
 const url='/?post=12345678-1234-1234-1234-123456789abc';
 handlers.push({data:{json:()=>({version:1,title:'花子さんが投稿しました',body:'こんにちは',url})},waitUntil:p=>work=p});await work;assert.equal(shown[0].title,'花子さんが投稿しました');assert.equal(shown[0].options.body,'こんにちは');
 handlers.notificationclick({notification:{data:{url},close(){}},waitUntil:p=>work=p});await work;assert.equal(opened,'https://sns.test'+url);
 handlers.notificationclick({notification:{data:{url:'https://evil.example/'} ,close(){}},waitUntil:p=>work=p});await work;assert.equal(opened,'https://sns.test/');
 handlers.push({data:{json(){throw Error('bad data')}},waitUntil:p=>work=p});await work;assert.equal(shown.at(-1).title,'つながり');
});

test('post link UI retains the requested post for login and clears it when returning to the feed',()=>{
 const events={},els=new Map();const $=key=>{if(!els.has(key))els.set(key,{hidden:true,addEventListener:(name,f)=>events[key+name]=f});return els.get(key)};
 const location={search:'?post=12345678-1234-1234-1234-123456789abc',href:'https://sns.test/?post=12345678-1234-1234-1234-123456789abc'};let mode;
 const context={$ ,URL,URLSearchParams,window:{location,history:{replaceState(a,b,url){location.href='https://sns.test'+url;location.search=new URL(location.href).search}},addEventListener:(n,f)=>events[n]=f},document:{addEventListener:(n,f)=>events[n]=f},category:'',setMode:v=>mode=v};
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/post-link.js','utf8'),context);assert.equal(vm.runInContext('syncLinkedPost()',context),'12345678-1234-1234-1234-123456789abc');assert.equal($('#notification-post-banner').hidden,false);
 $('#notification-post-back').onclick();assert.equal(mode,'all');assert.equal(location.search,'');assert.equal($('#notification-post-banner').hidden,true);
});
