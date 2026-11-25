import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import worker from './dist/server/index.js';
import {createEnv} from './local-adapter.mjs';
import {createStorage} from './node-storage.mjs';

test('profiles support private media, editing, removal, validation and ownership',async()=>{
 const env=createEnv();env.ADMIN_SETUP_TOKEN='profile-test-only-setup-code-32-characters';const cookies={};
 async function request(url,{user='alice',method='GET',body,origin='https://test.local'}={}){
  const headers={origin};if(cookies[user])headers.cookie=cookies[user];
  if(body&&!(body instanceof FormData)){headers['content-type']='application/json';body=JSON.stringify(body)}
  return worker.fetch(new Request('https://test.local'+url,{method,headers,body}),env);
 }
 try{
  const reg=await request('/api/auth/register',{method:'POST',body:{username:'alice',name:'Alice',password:'profile-test-password',code:env.ADMIN_SETUP_TOKEN}});assert.equal(reg.status,201);cookies.alice=reg.headers.get('set-cookie').split(';')[0];
  const invite=await(await request('/api/admin/invites',{method:'POST',body:{username:'bob'}})).json();
  const regBob=await request('/api/auth/register',{user:'bob',method:'POST',body:{username:'bob',name:'Bob',password:'profile-test-password-bob',code:invite.code}});assert.equal(regBob.status,201);cookies.bob=regBob.headers.get('set-cookie').split(';')[0];
  const before=await(await request('/api/me')).json(),bob=await(await request('/api/me',{user:'bob'})).json();
  const form=new FormData();form.set('name','Alice updated');form.set('bio','好きなこと\nものづくり');form.set('location','東京');form.set('website','https://example.com');form.set('id',bob.id);
  const bytes=fs.readFileSync('public/icon-192.png');form.set('avatar',new File([bytes],'avatar.png',{type:'image/png'}));form.set('header',new File([bytes],'header.png',{type:'image/png'}));
  assert.equal((await request('/api/me',{method:'PATCH',body:form})).status,200);
  const after=await(await request('/api/me')).json();assert.equal(after.name,'Alice updated');assert.equal(after.bio,'好きなこと\nものづくり');assert.equal('website' in after,false);assert.equal('department' in after,false);assert.equal(after.id,before.id);assert.equal(env.files.size,2);
  assert.equal((await(await request('/api/me',{user:'bob'})).json()).name,'Bob');
  assert.equal((await request('/api/profiles/'+before.id,{user:null})).status,401);
  const view=await(await request('/api/profiles/'+before.id,{user:'bob'})).json();assert.equal(view.avatar_key,after.avatar_key);assert.equal('password_hash' in view,false);assert.equal('role' in view,false);assert.equal('website' in view,false);
  for(const key of [after.avatar_key,after.header_key]){assert.equal((await request('/media/'+key,{user:null})).status,401);assert.equal((await request('/media/'+key,{user:'bob'})).status,200)}
  assert.equal((await request('/api/profiles/'+before.id,{user:'bob',method:'PATCH',body:{name:'intruder'}})).status,405);
  assert.equal((await request('/api/me',{method:'PATCH',origin:'https://evil.local',body:{bio:'evil'}})).status,403);
  for(const body of [{bio:'x'.repeat(161)},{name:''},{location:'x'.repeat(31)},{website:'javascript:alert(1)'},{website:'https://user:pass@example.com'}])assert.equal((await request('/api/me',{method:'PATCH',body})).status,400);
  const bad=new FormData();bad.set('name','must not save');bad.set('avatar',new File(['<svg/>'],'image.png',{type:'image/png'}));assert.equal((await request('/api/me',{method:'PATCH',body:bad})).status,400);assert.equal((await(await request('/api/me')).json()).name,'Alice updated');assert.equal(env.files.size,2);
  const post=new FormData();post.set('body','profile test');assert.equal((await request('/api/posts',{method:'POST',body:post})).status,201);
  const feed=await(await request('/api/posts',{user:'bob'})).json();assert.equal(feed.posts[0].avatar_key,after.avatar_key);assert.equal('department' in feed.posts[0],false);
  const replacement=new FormData();replacement.set('avatar',new File([bytes],'new.png'));assert.equal((await request('/api/me',{method:'PATCH',body:replacement})).status,200);assert.equal((await request('/media/'+after.avatar_key)).status,404);assert.equal(env.files.size,2);
  const remove=new FormData();remove.set('remove_avatar','1');remove.set('remove_header','1');assert.equal((await request('/api/me',{method:'PATCH',body:remove})).status,200);assert.equal(env.files.size,0);assert.equal((await request('/media/'+after.header_key)).status,404);
 }finally{env.sqlite.close()}
});

test('existing databases upgrade without losing profiles and retain edits after restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sns-profile-migration-'));let storage;
 try{
  const db=new DatabaseSync(path.join(dir,'sns.sqlite'));
  for(const name of ['0000_initial.sql','0001_local_accounts.sql'])db.exec(fs.readFileSync('drizzle/'+name,'utf8'));
  db.exec("CREATE TABLE _node_migrations(name TEXT PRIMARY KEY NOT NULL); INSERT INTO _node_migrations VALUES ('0000_initial.sql'),('0001_local_accounts.sql'); INSERT INTO profiles(id,name,department) VALUES ('old-user','Existing','Old team');");db.close();
  storage=createStorage(dir);let profile=await storage.DB.prepare('SELECT * FROM profiles WHERE id=?').bind('old-user').first();assert.equal(profile.name,'Existing');assert.equal(profile.bio,'');
  await storage.DB.prepare('UPDATE profiles SET bio=?,avatar_key=? WHERE id=?').bind('Saved bio','aabbcc/0.png','old-user').run();await storage.BUCKET.put('aabbcc/0.png',fs.readFileSync('public/icon-192.png'));
  storage.close();storage=createStorage(dir);profile=await storage.DB.prepare('SELECT * FROM profiles WHERE id=?').bind('old-user').first();assert.equal(profile.bio,'Saved bio');assert.equal(profile.avatar_key,'aabbcc/0.png');assert.ok(await storage.BUCKET.get(profile.avatar_key));
 }finally{storage?.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true})}
});
