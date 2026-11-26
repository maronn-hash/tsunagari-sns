import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import worker from './dist/server/index.js';
import {createStorage} from './node-storage.mjs';
import {runContentMaintenance,cancelContentPush} from './moderation-core.mjs';
import {createContentMaintenance} from './node-moderation.mjs';
import {createPushService} from './node-push.mjs';

async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sns-moderation-')),env=createStorage(dir);env.ADMIN_SETUP_TOKEN='moderation-test-bootstrap-secret-32-characters';
 t.after(()=>{env.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true})});let seq=0;
 const req=(url,{cookie='',method='GET',body,origin='https://sns.test',headers={}}={})=>worker.fetch(new Request('https://sns.test'+url,{method,headers:{cookie,origin,'cf-connecting-ip':'192.0.2.'+(++seq),...(body!==undefined&&!(body instanceof FormData)?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),env);
 const cookie=r=>r.headers.get('set-cookie').split(';')[0];
 const a=cookie(await req('/api/auth/register',{method:'POST',body:{username:'admin',name:'管理者',password:'moderation-test-password',code:env.ADMIN_SETUP_TOKEN}}));
 const invite=await(await req('/api/admin/invites',{cookie:a,method:'POST',body:{username:'member'}})).json();
 const b=cookie(await req('/api/auth/register',{method:'POST',body:{username:'member',name:'メンバー',password:'moderation-test-password',code:invite.code}}));
 const member=await(await req('/api/me',{cookie:b})).json();
 async function post(body='管理対象の投稿'){const form=new FormData();form.set('body',body);const r=await req('/api/posts',{cookie:b,method:'POST',body:form});assert.equal(r.status,201);return (await r.json()).id}
 async function comment(id){assert.equal((await req('/api/posts/'+id+'/comments',{cookie:b,method:'POST',body:{body:'管理対象の返信'}})).status,201);return (await(await req('/api/posts/'+id+'/comments',{cookie:b})).json()).at(-1).id}
 const mod=(kind,id,action,extra={})=>req(`/api/admin/moderation/content/${kind}/${id}`,{cookie:a,method:'POST',body:{action,reason:'運用ルールに基づく確認',...extra}});
 return {dir,env,req,a,b,member,post,comment,mod};
}

test('reports are private to admins, validated, deduplicated and resolved with an audit reason',async t=>{
 const {env,req,a,b,post,mod}=await setup(t),id=await post();
 for(const endpoint of ['content','reports','audit','retention'])assert.equal((await req('/api/admin/moderation/'+endpoint,{cookie:b})).status,403);
 const report={kind:'post',id,category:'個人情報・機密情報',detail:'<script>機密</script>'};
 assert.equal((await req('/api/reports',{method:'POST',body:report})).status,401);
 assert.equal((await req('/api/reports',{cookie:b,origin:'https://wrong.test',method:'POST',body:report})).status,403);
 for(const body of [null,{...report,kind:'accounts'},{...report,category:'invalid'},{...report,detail:'a'.repeat(501)}])assert.equal((await req('/api/reports',{cookie:b,method:'POST',body})).status,400);
 assert.equal((await req('/api/reports',{cookie:b,method:'POST',body:report})).status,201);
 assert.equal((await(await req('/api/reports',{cookie:b,method:'POST',body:report})).json()).duplicate,true);
 const rows=await(await req('/api/admin/moderation/reports',{cookie:a})).json();assert.equal(rows.items.length,1);assert.equal(rows.items[0].reporter_name,'メンバー');
 assert.equal((await req(`/api/admin/moderation/content/post/${id}`,{cookie:b,method:'POST',body:{action:'hide',reason:'偽装',role:'admin'}})).status,403);
 assert.equal((await mod('post',id,'hide',{reason:''})).status,400);
 const endpoint='/api/admin/moderation/reports/'+rows.items[0].id;
 assert.equal((await req(endpoint,{cookie:a,method:'POST',body:{reason:'確認済み・問題なし'}})).status,200);
 assert.equal((await req(endpoint,{cookie:a,method:'POST',body:{reason:'再実行'}})).status,409);
 assert.equal((await env.DB.prepare('SELECT hidden FROM posts WHERE id=?').bind(id).first()).hidden,0);
 const audit=await(await req('/api/admin/moderation/audit',{cookie:a})).json();assert.equal(audit.items[0].action,'resolve_report');assert.equal(audit.items[0].actor_name,'管理者');
});

test('hidden posts and replies disappear from feeds, search, counts, media and member actions; admins can restore',async t=>{
 const {env,req,a,b,member,post,comment,mod}=await setup(t),id=await post(),cid=await comment(id),key=id+'/0.png';
 await env.BUCKET.put(key,new Uint8Array([137,80,78,71]));await env.DB.prepare('UPDATE posts SET images=? WHERE id=?').bind(JSON.stringify([key]),id).run();
 assert.equal((await mod('comment',cid,'hide')).status,200);
 assert.equal((await(await req('/api/posts/'+id+'/comments',{cookie:b})).json()).length,0);
 assert.equal((await(await req('/api/posts',{cookie:b})).json()).posts[0].comment_count,0);
 assert.equal((await mod('comment',cid,'restore')).status,200);
 assert.equal((await mod('post',id,'hide')).status,200);
 for(const endpoint of ['/api/posts','/api/posts?q=管理対象','/api/posts?id='+id]){const data=await(await req(endpoint,{cookie:b})).json();assert.equal(data.posts.length,0)}
 for(const method of ['GET','HEAD'])assert.equal((await req('/media/'+key,{cookie:b,method})).status,404);
 assert.equal((await req('/media/'+key,{cookie:a})).status,200);
 for(const method of ['GET','POST'])assert.equal((await req('/api/posts/'+id+'/comments',{cookie:b,method,...(method==='POST'?{body:{body:'hidden'}}:{})})).status,404);
 assert.equal((await req('/api/posts/'+id+'/like',{cookie:b,method:'POST'})).status,404);
 assert.equal((await req('/api/reports',{cookie:b,method:'POST',body:{kind:'comment',id:cid,category:'その他'}})).status,404);
 const managed=await(await req('/api/admin/moderation/content?kind=post&state=hidden&q=管理対象',{cookie:a})).json();assert.equal(managed.items[0].id,id);
 const profile=await(await req('/api/profiles/'+member.id,{cookie:b})).json();assert.equal(profile.post_count,0);
 assert.equal((await mod('post',id,'restore')).status,200);assert.equal((await req('/media/'+key,{cookie:b})).status,200);
 assert.equal((await(await req('/api/posts/'+id+'/comments',{cookie:b})).json()).length,1);
});

test('permanent deletion requires confirmation, removes children and retries failed attachment deletion',async t=>{
 const {env,req,a,b,post,comment,mod}=await setup(t),id=await post(),cid=await comment(id),key=id+'/0.mp4';
 await env.BUCKET.put(key,new Uint8Array([1,2,3]));await env.DB.prepare('UPDATE posts SET images=? WHERE id=?').bind(JSON.stringify([key]),id).run();
 await req('/api/reports',{cookie:b,method:'POST',body:{kind:'comment',id:cid,category:'その他'}});
 await req('/api/posts/'+id+'/like',{cookie:a,method:'POST'});
 assert.equal((await mod('post',id,'delete')).status,400);
 const originalDelete=env.BUCKET.delete;env.BUCKET.delete=async()=>{throw Error('temporary I/O failure')};
 assert.equal((await mod('post',id,'delete',{confirm:true})).status,200);
 for(const table of ['posts','comments','likes'])assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM '+table).first()).n,0);
 assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM media_deletions').first()).n,1);
 assert.equal((await req('/media/'+key,{cookie:a})).status,404);
 const reports=await(await req('/api/admin/moderation/reports?status=resolved',{cookie:a})).json();assert.equal(reports.items[0].body,null);assert.equal(reports.items[0].resolution,'運用ルールに基づく確認');
 env.BUCKET.delete=originalDelete;await runContentMaintenance(env);assert.equal(await env.BUCKET.get(key),null);
 assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM media_deletions').first()).n,0);
 assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM moderation_audit WHERE action='delete'").first()).n,1);
});

test('retention defaults off, requires explicit confirmed settings and deletes only expired content',async t=>{
 const {env,req,a,post,comment}=await setup(t),now=Date.now(),day=86400000;
 const old=await post(),fresh=await post('新しい投稿'),oldReply=await comment(fresh);await comment(old);
 await env.DB.prepare('UPDATE posts SET created=? WHERE id=?').bind(now-31*day,old).run();await env.DB.prepare('UPDATE comments SET created=? WHERE id=?').bind(now-31*day,oldReply).run();
 assert.equal((await runContentMaintenance(env,now)).posts,0);
 const put=body=>req('/api/admin/moderation/retention',{cookie:a,method:'PUT',body});
 assert.equal((await put({days:30,reason:'保存方針',confirm:true})).status,503);env.CONTENT_MAINTENANCE=true;
 for(const body of [{days:1,reason:'保存方針',confirm:true},{days:30,reason:'保存方針'},{days:30,reason:'',confirm:true}])assert.equal((await put(body)).status,400);
 const preview=await(await req('/api/admin/moderation/retention?days=30',{cookie:a})).json();assert.equal(preview.posts,1);assert.equal(preview.comments,2);
 assert.equal((await put({days:30,reason:'保存方針',confirm:true})).status,200);
 const removed=await runContentMaintenance(env,now);assert.equal(removed.posts,1);assert.equal(removed.comments,1);
 assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM posts').first()).n,1);assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM comments').first()).n,0);
 assert.equal((await put({days:0,reason:'自動削除を停止'})).status,200);
 await env.DB.prepare('UPDATE posts SET created=1').run();assert.equal((await runContentMaintenance(env,now)).posts,0);
 const maintenance=createContentMaintenance(env,{intervalMs:999999});await maintenance.run();await maintenance.close();assert.equal(env.CONTENT_MAINTENANCE,false);
});

test('upgrade preserves old posts and replies; moderation settings persist after restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sns-mod-upgrade-'));let env;
 try{const old=new DatabaseSync(path.join(dir,'sns.sqlite'));old.exec('CREATE TABLE _node_migrations(name TEXT PRIMARY KEY NOT NULL)');
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0007').sort()){old.exec(fs.readFileSync('drizzle/'+name,'utf8'));old.prepare('INSERT INTO _node_migrations VALUES (?)').run(name)}
 old.exec("INSERT INTO profiles(id,name) VALUES ('old-user','以前のメンバー'); INSERT INTO posts(id,author,body,category,images,created) VALUES ('old-post','old-user','以前の投稿','日々のこと','[]',1); INSERT INTO comments(id,post_id,author,body,created) VALUES ('old-reply','old-post','old-user','以前の返信',1)");old.close();
 env=createStorage(dir);env.close();const db=new DatabaseSync(path.join(dir,'sns.sqlite'));
 assert.equal(db.prepare('SELECT hidden FROM posts').get().hidden,0);assert.equal(db.prepare('SELECT hidden FROM comments').get().hidden,0);assert.equal(db.prepare('SELECT retention_days FROM moderation_settings').get().retention_days,0);
 db.exec('UPDATE moderation_settings SET retention_days=90');db.close();env=createStorage(dir);env.close();env=null;
 const check=new DatabaseSync(path.join(dir,'sns.sqlite'));assert.equal(check.prepare('SELECT retention_days FROM moderation_settings').get().retention_days,90);check.close();
 }finally{env?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true})}
});

test('queued notifications are cancelled and delivery rechecks hidden posts and replies',async t=>{
 const {env,dir,post,comment,member}=await setup(t),id=await post(),cid=await comment(id);let sent=0;
 const session=await env.DB.prepare('SELECT token_hash FROM sessions WHERE user_id=?').bind(member.id).first();const endpoint='https://web.push.apple.com/Q-moderation-test';
 await env.DB.prepare('INSERT INTO push_subscriptions(endpoint,user_id,session_hash,created) VALUES (?,?,?,?)').bind(endpoint,member.id,session.token_hash,Date.now()).run();
 const push=createPushService({env,directory:dir,origin:'https://sns.test',intervalMs:999999,send:async()=>{sent++;return new Response(null,{status:201})}});
 try{
  await push.enqueue({payload:{url:'/?post='+id,body:'内容'}});await cancelContentPush(env.DB,id).run();assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM push_jobs').first()).n,0);
  await push.enqueue({payload:{url:'/?post='+id,body:'内容'}});await env.DB.prepare('UPDATE posts SET hidden=1 WHERE id=?').bind(id).run();await push.drain();assert.equal(sent,0);
  await env.DB.prepare('UPDATE posts SET hidden=0 WHERE id=?').bind(id).run();await push.enqueue({payload:{url:'/?post='+id,commentId:cid,body:'返信'}});await env.DB.prepare('UPDATE comments SET hidden=1 WHERE id=?').bind(cid).run();await push.drain();assert.equal(sent,0);
  await push.enqueue({payload:{url:'/?post='+id,body:'内容'}});await push.drain();assert.equal(sent,1);
 }finally{await push.close()}
});

test('moderation UI escapes user content, guards admin actions and ignores responses after logout',async()=>{
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,disabled:false,classList:{toggle(){}},setAttribute(){},showModal(){this.open=true},close(){this.open=false}});return elements.get(id)};
 const context={$,$$:()=>[],me:{id:'member',role:'member'},document:{addEventListener(){}},URLSearchParams,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:async()=>({items:[],more:false})};vm.createContext(context);vm.runInContext(fs.readFileSync('public/moderation.js','utf8'),context);const run=s=>vm.runInContext(s,context);
 await run('openModeration()');assert.equal($('#moderation-dialog').open,false);assert.doesNotMatch(run("moderationLinks('post','id')"),/data-manage/);
 context.me={id:'admin',role:'admin'};assert.match(run("moderationLinks('post','id')"),/data-manage/);
 context.api=async()=>({items:[{id:'x',kind:'post',name:'<img onerror=x>',body:'<script>alert(1)</script>',created:1,images:[]}],more:false});await run("openModeration({kind:'post',id:'x'})");assert.match($('#moderation-list').innerHTML,/&lt;script&gt;/);assert.doesNotMatch($('#moderation-list').innerHTML,/<script>/);
 let resolve;context.api=()=>new Promise(r=>resolve=r);const pending=run('loadModeration()');context.me=null;run('resetModeration()');resolve({items:[{body:'private'}]});await pending;assert.equal($('#moderation-list').textContent,'');
 const html=fs.readFileSync('public/index.html','utf8'),script=fs.readFileSync('public/moderation.js','utf8');for(const [,id] of script.matchAll(/\$\('#([^']+)'\)/g))assert.ok(html.includes(`id="${id}"`),'missing element '+id);
});
