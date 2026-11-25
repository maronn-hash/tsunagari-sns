import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import worker from './dist/server/index.js';
import {createEnv} from './local-adapter.mjs';
import {createStorage} from './node-storage.mjs';

test('calendar shares events with members and enforces ownership, dates and authentication',async()=>{
 const env=createEnv();env.ADMIN_SETUP_TOKEN='calendar-test-bootstrap-secret-32-characters';let seq=0;
 async function req(p,{method='GET',cookie='',body,origin='https://cal.test'}={}){const headers={origin,cookie,'cf-connecting-ip':'192.0.2.'+(++seq)};if(body!==undefined){headers['content-type']='application/json';body=JSON.stringify(body)}return worker.fetch(new Request('https://cal.test'+p,{method,headers,body}),env)}
 const getCookie=r=>r.headers.get('set-cookie').split(';')[0];
 try{
 const a=getCookie(await req('/api/auth/register',{method:'POST',body:{username:'admin',name:'Admin',password:'calendar-password-123',code:env.ADMIN_SETUP_TOKEN}}));
 const invite=await(await req('/api/admin/invites',{method:'POST',cookie:a,body:{username:'member'}})).json();
 const b=getCookie(await req('/api/auth/register',{method:'POST',body:{username:'member',name:'Member',password:'calendar-password-123',code:invite.code}}));
 const event={title:'打ち合わせ 🌸',event_date:'2026-11-19',start_time:'10:00',end_time:'11:00',notes:'会議室\n資料を持参'};
 assert.equal((await req('/api/events?month=2026-11')).status,401);
 assert.equal((await req('/api/events',{method:'POST',body:event})).status,401);
 assert.equal((await req('/api/events',{method:'POST',cookie:b,body:event})).status,403);
 const created=await req('/api/events',{method:'POST',cookie:a,body:event});assert.equal(created.status,201);const {id}=await created.json();
 const list=async(cookie,month='2026-11')=>(await(await req('/api/events?month='+month,{cookie})).json()).events;
 assert.equal((await list(a))[0].mine,true);assert.equal((await list(b))[0].mine,false);assert.equal((await list(a))[0].notes,event.notes);assert.equal((await list(a,'2026-12')).length,0);
 for(const method of ['PATCH','DELETE'])assert.equal((await req('/api/events/'+id,{cookie:b,method,body:method==='PATCH'?event:undefined})).status,403);
 assert.equal((await req('/api/events/'+id,{cookie:a,method:'PATCH',body:event,origin:'https://other.test'})).status,403);
 for(const change of [{title:''},{title:'a'.repeat(81)},{notes:'a'.repeat(501)},{event_date:'2026-02-29'},{event_date:'2026-13-01'},{start_time:'25:00'},{start_time:'',end_time:'11:00'},{end_time:'09:00'},{event_date:'1800-01-01'}])assert.equal((await req('/api/events',{cookie:a,method:'POST',body:{...event,...change}})).status,400,JSON.stringify(change));
 assert.equal((await req('/api/events?month=2026-13',{cookie:b})).status,400);
 assert.equal((await req('/api/events',{cookie:a,method:'POST',body:{title:'終日',event_date:'2028-02-29'}})).status,201);
 assert.equal((await list(a,'2028-02'))[0].start_time,'');
 assert.equal((await req('/api/events/'+id,{cookie:a,method:'PATCH',body:{...event,title:'変更済み',event_date:'2026-12-01'}})).status,200);
 assert.equal((await list(a)).length,0);assert.equal((await list(a,'2026-12'))[0].title,'変更済み');
 assert.equal((await req('/api/events/'+id,{cookie:a,method:'DELETE'})).status,200);assert.equal((await list(a,'2026-12')).length,0);
 assert.equal((await req('/api/events/'+id,{cookie:a,method:'DELETE'})).status,404);
 }finally{env.sqlite.close()}
});
test('existing databases add calendar without losing data and retain events after restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsunagari-calendar-'));let env;
 try{
 const db=new DatabaseSync(path.join(dir,'sns.sqlite'));
 db.exec('CREATE TABLE _node_migrations (name TEXT PRIMARY KEY NOT NULL)');
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0003').sort()){db.exec(fs.readFileSync('drizzle/'+name,'utf8'));db.prepare('INSERT INTO _node_migrations VALUES (?)').run(name)}
 db.prepare('INSERT INTO profiles(id,name) VALUES (?,?)').run('existing-user','既存ユーザー');
 db.prepare('INSERT INTO posts(id,author,body,category,images,created) VALUES (?,?,?,?,?,?)').run('existing-post','existing-user','既存の投稿','日々のこと','[]',1);db.close();
 env=createStorage(dir);
 assert.equal((await env.DB.prepare('SELECT body FROM posts WHERE id=?').bind('existing-post').first()).body,'既存の投稿');
 await env.DB.prepare('INSERT INTO calendar_events(id,author,title,event_date,created,updated) VALUES (?,?,?,?,?,?)').bind('event','existing-user','残る予定','2026-11-19',1,1).run();env.close();env=null;
 env=createStorage(dir);assert.equal((await env.DB.prepare('SELECT title FROM calendar_events WHERE id=?').bind('event').first()).title,'残る予定');
 }finally{env?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true})}
});

