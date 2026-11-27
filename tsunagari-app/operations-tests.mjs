import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {createStorage} from './node-storage.mjs';
import {createOperations} from './node-operations.mjs';
import {writeBackup,verifyBackup,restoreBackup} from './backup-files.mjs';
import worker from './dist/server/index.js';
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sns-operations-')),dir=path.join(root,'data'),env=createStorage(dir);env.ADMIN_SETUP_TOKEN='operations-test-bootstrap-secret-32-characters';
 env.OPS=createOperations(env,{directory:dir,intervalMs:999999,startDelayMs:999999});
 t.after(async()=>{await env.OPS.close();env.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true})});let seq=0;
 const req=(url,{cookie='',method='GET',body,origin='https://sns.test'}={})=>worker.fetch(new Request('https://sns.test'+url,{method,headers:{origin,cookie,'cf-connecting-ip':'192.0.2.'+(++seq),...(body===undefined||body instanceof FormData?{}:{'content-type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),env);
 const ares=await req('/api/auth/register',{method:'POST',body:{username:'admin',name:'管理者',password:'operations-test-password',code:env.ADMIN_SETUP_TOKEN}});assert.equal(ares.status,201);const a=ares.headers.get('set-cookie').split(';')[0];
 const invitation=await(await req('/api/admin/invites',{cookie:a,method:'POST',body:{username:'member'}})).json();
 const bres=await req('/api/auth/register',{method:'POST',body:{username:'member',name:'メンバー',password:'operations-test-password',code:invitation.code}});assert.equal(bres.status,201);const b=bres.headers.get('set-cookie').split(';')[0],member=await(await req('/api/me',{cookie:b})).json();
 return {root,dir,env,req,a,b,member};
}
test('backup and monitoring APIs enforce admin/origin checks and audits exclude secrets',async t=>{
 const {env,req,a,b}=await setup(t);
 for(const endpoint of ['status','audit','events']){assert.equal((await req('/api/admin/operations/'+endpoint)).status,401);assert.equal((await req('/api/admin/operations/'+endpoint,{cookie:b})).status,403)}
 assert.equal((await req('/api/admin/operations/backup',{cookie:b,method:'POST'})).status,403);
 assert.equal((await req('/api/admin/operations/backup',{cookie:a,method:'POST',origin:'https://wrong.test'})).status,403);
 assert.equal((await req('/api/admin/operations/settings',{cookie:a,method:'PUT',body:{enabled:false,keep_count:1}})).status,400);
 assert.equal((await req('/api/admin/operations/settings',{cookie:a,method:'PUT',body:{enabled:false,keep_count:14}})).status,200);
 assert.equal((await req('/api/admin/operations/status',{cookie:a})).headers.get('cache-control'),'no-store');
 await req('/api/auth/login',{method:'POST',body:{username:'admin',password:'SUPER-SECRET-WRONG-PASSWORD'}});
 await req('/api/auth/login',{method:'POST',body:{username:'member',password:'operations-test-password'}});
 await req('/api/admin/operations/secret-password-in-path',{cookie:a,method:'POST'});
 const rows=(await(await req('/api/admin/operations/audit',{cookie:a})).json()).items;
 assert.ok(rows.some(r=>r.target==='auth/login'&&r.status===200&&r.actor_name==='メンバー'));
 assert.ok(rows.some(r=>r.target==='auth/login'&&r.status===401&&r.actor_name==='未認証'));
 const dump=JSON.stringify(rows);assert.doesNotMatch(dump,/SUPER-SECRET|operations-test-password|secret-password-in-path|__Host-tsunagari/);
 assert.equal((await env.DB.prepare('SELECT keep_count FROM backup_settings').first()).keep_count,14);
});
test('consistent WAL database/media backup restores accounts and removes stale sessions and invites',async t=>{
 const {root,dir,env,req,a,b,member}=await setup(t);
 const id=crypto.randomUUID(),key=id+'/0.mp4',avatar=crypto.randomUUID()+'/0.png';
 await env.BUCKET.put(key,new Uint8Array([1,2,3,4]));await env.BUCKET.put(avatar,new Uint8Array([5,6]));
 await env.DB.prepare('INSERT INTO posts(id,author,body,category,images,created) VALUES (?,?,?,?,?,?)').bind(id,member.id,'復元する本文','日々のこと',JSON.stringify([key]),Date.now()).run();
 await env.DB.prepare('UPDATE profiles SET avatar_key=? WHERE id=?').bind(avatar,member.id).run();
 const invitation=await(await req('/api/admin/invites',{cookie:a,method:'POST',body:{username:'unused'}})).json();
 fs.writeFileSync(path.join(dir,'push-keys.json'),'private-key-test');
 const accepted=await req('/api/admin/operations/backup',{cookie:a,method:'POST'});assert.equal(accepted.status,202);
 // A running request cannot create a concurrent snapshot.
 assert.equal((await env.OPS.backup()).ok,false);await env.OPS.idle();
 const status=await env.OPS.status(),run=status.runs.find(x=>x.status==='success');assert.ok(run);const source=path.join(status.backupDirectory,run.id);const manifest=verifyBackup(source);assert.ok(manifest.files.some(f=>f.path==='media/'+avatar));
 const restored=path.join(root,'restored');restoreBackup(source,restored);assert.throws(()=>restoreBackup(source,restored));
 assert.deepEqual(fs.readFileSync(path.join(restored,'media',key)),Buffer.from([1,2,3,4]));
 const db=new DatabaseSync(path.join(restored,'sns.sqlite'));assert.equal(db.prepare('SELECT body FROM posts WHERE id=?').get(id).body,'復元する本文');assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.prepare("SELECT count(*) AS n FROM invitations WHERE username='unused'").get().n,0);db.close();
 const recovered=createStorage(restored);recovered.ADMIN_SETUP_TOKEN=env.ADMIN_SETUP_TOKEN;
 try{const request=(cookie,body)=>worker.fetch(new Request('https://sns.test'+(body?'/api/auth/login':'/api/me'),{method:body?'POST':'GET',headers:{origin:'https://sns.test',cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),recovered);
 assert.equal((await request(b)).status,401);assert.equal((await request('',{username:'member',password:'operations-test-password'})).status,200);
 }finally{recovered.close()}
 assert.ok(invitation.code);assert.equal((await req('/api/me',{cookie:b})).status,200,'live sessions are unchanged');
});
test('backup failures preserve the prior generation, automatic scheduling and pruning work',async t=>{
 const {dir,env}=await setup(t);await env.OPS.check();await env.OPS.idle();let status=await env.OPS.status();assert.equal(status.runs.filter(r=>r.status==='success').length,1);
 await env.OPS.check();await env.OPS.idle();assert.equal((await env.OPS.status()).runs.length,1,'no extra daily backup');
 const original=env.snapshot;env.snapshot=()=>{throw Error('disk full: private path')};await env.OPS.backup();await env.OPS.idle();status=await env.OPS.status();assert.equal(status.runs[0].status,'failed');assert.ok(status.alerts.includes('backup_failed'));assert.equal(status.runs.filter(r=>r.status==='success').length,1);assert.doesNotMatch(JSON.stringify(status),/private path/);
 env.snapshot=original;for(let n=0;n<7;n++){await env.OPS.backup();await env.OPS.idle()}
 status=await env.OPS.status();assert.equal(status.runs.filter(r=>r.status==='success').length,7);assert.equal(status.runs.filter(r=>r.status==='pruned').length,1);
 const folders=fs.readdirSync(dir+'-backups').filter(n=>n.startsWith('backup-'));assert.equal(folders.length,7);
 await env.DB.prepare('UPDATE backup_settings SET enabled=0').run();await env.DB.prepare('UPDATE backup_runs SET created=1').run();await env.OPS.check();await env.OPS.idle();assert.equal(fs.readdirSync(dir+'-backups').filter(n=>n.startsWith('backup-')).length,7);
});
test('corrupt, incomplete and path-traversal backups are rejected before creating restore targets',async t=>{
 const {root,dir,env,member}=await setup(t),source=path.join(root,'copy');writeBackup(env,dir,source);const manifestPath=path.join(source,'manifest.json'),original=fs.readFileSync(manifestPath),m=JSON.parse(original);
 m.files.push({path:'../escape',bytes:0,sha256:''});fs.writeFileSync(manifestPath,JSON.stringify(m));assert.throws(()=>restoreBackup(source,path.join(root,'restore-bad')));assert.equal(fs.existsSync(path.join(root,'restore-bad')),false);
 fs.writeFileSync(manifestPath,original);fs.appendFileSync(path.join(source,'sns.sqlite'),'corrupt');assert.throws(()=>verifyBackup(source));
 const missing=crypto.randomUUID()+'/0.png';await env.DB.prepare('UPDATE profiles SET avatar_key=? WHERE id=?').bind(missing,member.id).run();assert.throws(()=>writeBackup(env,dir,path.join(root,'incomplete')));
 assert.throws(()=>createOperations(env,{directory:dir,backupDirectory:path.join(dir,'nested')}));
 if(process.platform!=='win32'){const link=path.join(root,'linked');fs.symlinkSync(source,link,'dir');assert.throws(()=>verifyBackup(link))}
});
test('monitoring detects failures and persists audit history across database restart',async t=>{
 const {env,dir,req,a}=await setup(t);const now=Date.now();
 for(let n=0;n<10;n++)await env.DB.prepare('INSERT INTO operation_audit VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),null,'未認証','POST','auth/login',401,now).run();
 env.OPS.observe(500,2500);await env.OPS.event('push_failed');let status=await env.OPS.status();assert.ok(status.alerts.includes('login_failures'));assert.ok(status.alerts.includes('recent_errors'));assert.equal(status.errors,1);assert.equal(status.slow,1);
 const conn=new DatabaseSync(path.join(dir,'sns.sqlite'),{readOnly:true});assert.ok(conn.prepare('SELECT count(*) AS n FROM operation_audit').get().n>=10);conn.close();
 await env.DB.prepare("INSERT INTO operation_audit VALUES ('old',NULL,'x','POST','auth/login',401,1)").run();await env.OPS.check();assert.equal(await env.DB.prepare("SELECT id FROM operation_audit WHERE id='old'").first(),null);
 assert.equal((await req('/api/admin/operations/events',{cookie:a})).status,200);
});
test('operations UI restricts admin access, escapes logs and discards stale responses',async()=>{
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,disabled:false,addEventListener(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false}});return elements.get(id)};
 const context={$,$$:()=>[],me:{id:'member',role:'member'},setInterval(){},document:{},esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:async()=>({items:[],more:false})};vm.createContext(context);vm.runInContext(fs.readFileSync('public/operations.js','utf8'),context);const run=s=>vm.runInContext(s,context);
 $('#open-operations').onclick();assert.equal($('#operations-dialog').open,false);context.me={id:'admin',role:'admin'};
 context.api=async()=>({items:[{actor_name:'<script>attack</script>',target:'auth/login',status:200,created:1,action:'POST'}],more:false});await run("opsTab='audit';loadOperations()");assert.match($('#ops-content').innerHTML,/&lt;script&gt;/);assert.doesNotMatch($('#ops-content').innerHTML,/<script>/);
 let resolve;context.api=()=>new Promise(r=>resolve=r);const pending=run('loadOperations()');context.me=null;run('resetOperations()');resolve({items:[{actor_name:'private'}]});await pending;assert.equal($('#ops-content').textContent,'');
});
