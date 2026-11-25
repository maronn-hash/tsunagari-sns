import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import worker from './dist/server/index.js';
import {createEnv} from './local-adapter.mjs';
import {createStorage} from './node-storage.mjs';

function harness(env){
 env.ADMIN_SETUP_TOKEN='test-admin-features-bootstrap-32-characters';let seq=0;
 const req=(url,{cookie='',method='GET',body,origin='https://test.sns',raw=false}={})=>{
  const headers={cookie,origin,'cf-connecting-ip':'192.0.2.'+(++seq)};
  if(body!==undefined&&!raw){headers['content-type']='application/json';body=JSON.stringify(body)}
  return worker.fetch(new Request('https://test.sns'+url,{method,headers,body}),env);
 };
 return {req,async admin(){const r=await req('/api/auth/register',{method:'POST',body:{username:'admin',name:'Admin',password:'test-long-password',code:env.ADMIN_SETUP_TOKEN}});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0]}};
}
test('comments can only be deleted by their authors; counts and other comments stay correct',async()=>{
 const env=createEnv(),{req,admin}=harness(env);
 try{
  const a=await admin();const invitation=await(await req('/api/admin/invites',{method:'POST',cookie:a,body:{username:'member'}})).json();
  const registered=await req('/api/auth/register',{method:'POST',body:{username:'member',name:'Member',password:'test-long-password',code:invitation.code}});assert.equal(registered.status,201);const b=registered.headers.get('set-cookie').split(';')[0];
  const form=new FormData();form.set('body','投稿');const post=await(await req('/api/posts',{method:'POST',cookie:a,body:form,raw:true})).json();
  for(const cookie of [a,b])assert.equal((await req(`/api/posts/${post.id}/comments`,{method:'POST',cookie,body:{body:'返信'}})).status,201);
  const comments=await(await req(`/api/posts/${post.id}/comments`,{cookie:b})).json(),mine=comments.find(c=>c.mine),other=comments.find(c=>!c.mine);
  assert.ok(mine&&other);
  const endpoint=`/api/posts/${post.id}/comments/${mine.id}`;
  assert.equal((await req(endpoint,{method:'DELETE'})).status,401);
  assert.equal((await req(endpoint,{method:'DELETE',cookie:a})).status,403);
  assert.equal((await req(`/api/posts/${post.id}/comments/${other.id}`,{method:'DELETE',cookie:b})).status,403);
  assert.equal((await req(endpoint,{method:'DELETE',cookie:b,origin:'https://wrong.test'})).status,403);
  assert.equal((await req(`/api/posts/${crypto.randomUUID()}/comments/${mine.id}`,{method:'DELETE',cookie:b})).status,404);
  assert.equal((await req(endpoint,{method:'DELETE',cookie:b})).status,200);
  assert.equal((await req(endpoint,{method:'DELETE',cookie:b})).status,404);
  const remaining=await(await req(`/api/posts/${post.id}/comments`,{cookie:b})).json();assert.equal(remaining.length,1);assert.equal(remaining[0].id,other.id);
  assert.equal((await(await req('/api/posts',{cookie:a})).json()).posts[0].comment_count,1);
  // Announcements are private to members, and writable only by administrators.
  assert.equal((await req('/api/announcement')).status,401);
  assert.deepEqual(await(await req('/api/announcement',{cookie:b})).json(),{body:'',updated:null});
  for(const body of [{body:'member message'},{body:'',role:'admin'}])assert.equal((await req('/api/announcement',{method:'PUT',cookie:b,body})).status,403);
  assert.equal((await req('/api/announcement',{method:'PUT',cookie:a,origin:'https://wrong.test',body:{body:'bad'}})).status,403);
  for(const body of [{body:'a'.repeat(1001)},{body:12},null])assert.equal((await req('/api/announcement',{method:'PUT',cookie:a,body})).status,400);
  assert.equal((await req('/api/announcement',{method:'PUT',cookie:a,body:'{',raw:true})).status,400);
  const text='お知らせ 🌸\n<script>alert(1)</script>';
  assert.equal((await req('/api/announcement',{method:'PUT',cookie:a,body:{body:text}})).status,200);
  assert.equal((await(await req('/api/announcement',{cookie:b})).json()).body,text);
  assert.equal((await req('/api/announcement',{method:'PUT',cookie:a,body:{body:''}})).status,200);
  assert.equal((await(await req('/api/announcement',{cookie:b})).json()).body,'');
 }finally{env.sqlite.close()}
});

test('announcement migration preserves previous data and the saved message survives restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tsunagari-announcement-'));let env;
 try{
  const db=new DatabaseSync(path.join(dir,'sns.sqlite'));db.exec('CREATE TABLE _node_migrations (name TEXT PRIMARY KEY NOT NULL)');
  for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0004').sort()){db.exec(fs.readFileSync('drizzle/'+name,'utf8'));db.prepare('INSERT INTO _node_migrations VALUES (?)').run(name)}
  db.exec("INSERT INTO profiles(id,name) VALUES ('old-user','Existing'); INSERT INTO posts(id,author,body,category,images,created) VALUES ('old-post','old-user','Existing post','日々のこと','[]',1); INSERT INTO comments(id,post_id,author,body,created) VALUES ('old-comment','old-post','old-user','Existing comment',1); INSERT INTO calendar_events(id,author,title,event_date,created,updated) VALUES ('old-event','old-user','Existing event','2026-11-22',1,1)");db.close();
  env=createStorage(dir);let h=harness(env);const cookie=await h.admin();
  assert.equal((await h.req('/api/announcement',{method:'PUT',cookie,body:{body:'次回の予定\n金曜日に集合'}})).status,200);
  env.close();env=createStorage(dir);h=harness(env);
  assert.equal((await(await h.req('/api/announcement',{cookie})).json()).body,'次回の予定\n金曜日に集合');
  assert.equal((await env.DB.prepare('SELECT body FROM posts WHERE id=?').bind('old-post').first()).body,'Existing post');
  assert.equal((await env.DB.prepare('SELECT body FROM comments WHERE id=?').bind('old-comment').first()).body,'Existing comment');
  assert.equal((await env.DB.prepare('SELECT title FROM calendar_events WHERE id=?').bind('old-event').first()).title,'Existing event');
 }finally{env?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true})}
});

test('announcement UI hides editor for members, renders plain text and discards stale requests on logout',async()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,value:'',disabled:false,open:false,addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){}});return elements.get(id)};
 const context={$,$$:()=>[],me:{id:'member',role:'member'},mode:'all',toast(){},window:{addEventListener(){}},api:async()=>({body:'<img src=x onerror=alert(1)>\n連絡'})};vm.createContext(context);
 vm.runInContext(fs.readFileSync('public/announcement.js','utf8'),context);const run=code=>vm.runInContext(code,context);
 await run('loadAnnouncement()');assert.equal($('#announcement-edit').hidden,true);assert.equal($('#announcement-body').textContent,'<img src=x onerror=alert(1)>\n連絡');
 $('#announcement-edit').onclick();assert.equal($('#announcement-dialog').open,false);
 context.api=async()=>({body:''});await run('loadAnnouncement()');assert.equal($('#welcome').hidden,true);
 context.me={id:'admin',role:'admin'};await run('loadAnnouncement()');assert.equal($('#welcome').hidden,false);assert.equal($('#announcement-edit').hidden,false);
 $('#announcement-edit').onclick();assert.equal($('#announcement-dialog').open,true);
 context.mode='mine';run('renderAnnouncement()');assert.equal($('#welcome').hidden,true);
 let resolve;context.api=()=>new Promise(r=>resolve=r);const pending=run('loadAnnouncement()');context.me=null;run('resetAnnouncement()');resolve({body:'private'});await pending;assert.equal($('#announcement-body').textContent,'');assert.equal($('#welcome').hidden,true);
});

test('calendar UI permits only administrators to open the add form',()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',hidden:false,value:'',disabled:false,open:false,addEventListener(){},showModal(){this.open=true},close(){this.open=false}});return elements.get(id)};
 const context={$,$$:()=>[],me:{id:'member',role:'member'},Intl,Date,esc:v=>String(v??''),api:async()=>({events:[]})};vm.createContext(context);
 vm.runInContext(fs.readFileSync('public/calendar.js','utf8'),context);const run=code=>vm.runInContext(code,context);
 run("calendarMonth='2026-11';calendarSelected='2026-11-22';renderCalendar()");assert.equal($('#calendar-add').hidden,true);
 $('#calendar-add').onclick();assert.equal($('#calendar-editor').open,false);
 run("editCalendarEvent({id:'event',mine:false,name:'Admin',title:'予定'})");assert.equal($('#event-save').hidden,true);assert.equal($('#event-fields').disabled,true);
 $('#calendar-editor').close();context.me={id:'admin',role:'admin'};run('renderCalendar()');assert.equal($('#calendar-add').hidden,false);
 $('#calendar-add').onclick();assert.equal($('#calendar-editor').open,true);assert.equal($('#event-save').hidden,false);
});

test('comment UI deletes a reply after confirmation, preserves the draft and updates its count',async()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,open:false,listeners:{},addEventListener(event,callback){this.listeners[event]=callback},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},setAttribute(){},classList:{toggle(){}}});return elements.get(id)};
 const context={document:{querySelector:$,querySelectorAll:()=>[]},window:{addEventListener(){}},Intl,Date,URL,console,setTimeout:()=>1,clearTimeout(){},avatarMarkup:()=>'',fetch:()=>assert.fail('network not expected')};vm.createContext(context);
 vm.runInContext(fs.readFileSync('public/app.js','utf8'),context);const run=code=>vm.runInContext(code,context);
 const comments=[{id:'c1',author:'me',name:'私',created:1,body:'<script>reply</script>',mine:true},{id:'c2',author:'other',name:'他の人',created:1,body:'reply',mine:false}];let deleted=false;
 context.mockAPI=async(url,options)=>{if(options?.method==='DELETE'){assert.equal(url,'/api/posts/p1/comments/c1');deleted=true;return {ok:true}}return deleted?comments.slice(1):comments};
 run("api=mockAPI;me={id:'me'};posts=[{id:'p1',name:'私',author:'me',created:1,images:[],body:'投稿',comment_count:2}]");
 await run("showComments('p1')");assert.equal(($('#comment-list').innerHTML.match(/data-delete-comment=/g)||[]).length,1);assert.match($('#comment-list').innerHTML,/&lt;script&gt;/);
 $('#comment-body').value='書きかけの返信';$('#comment-list').listeners.click({target:{closest:()=>({dataset:{deleteComment:'c1'}})}});
 assert.equal(deleted,false);assert.equal($('#comment-delete-dialog').open,true);await $('#confirm-comment-delete').onclick();
 assert.equal(deleted,true);assert.equal($('#comment-body').value,'書きかけの返信');assert.equal(run('posts[0].comment_count'),1);assert.doesNotMatch($('#comment-list').innerHTML,/data-delete-comment=/);
});
