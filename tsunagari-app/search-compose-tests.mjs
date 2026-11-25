import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from './dist/server/index.js';
import {createEnv} from './local-adapter.mjs';

test('body search supports partial text, emoji, filtering and paginated result counts',async()=>{
 const env=createEnv();env.ADMIN_SETUP_TOKEN='search-test-setup-code-at-least-32-characters';let cookie='';
 async function request(url,{method='GET',body,authenticated=true}={}){
  const headers={origin:'https://test.local'};if(cookie&&authenticated)headers.cookie=cookie;
  if(body&&!(body instanceof FormData)){headers['content-type']='application/json';body=JSON.stringify(body)}
  return worker.fetch(new Request('https://test.local'+url,{method,headers,body}),env);
 }
 try{
  const reg=await request('/api/auth/register',{method:'POST',body:{username:'searcher',name:'NameOnlyKeyword',password:'search-test-password',code:env.ADMIN_SETUP_TOKEN}});assert.equal(reg.status,201);cookie=reg.headers.get('set-cookie').split(';')[0];
  const me=await(await request('/api/me')).json();
  for(let i=0;i<23;i++)await env.DB.prepare('INSERT INTO posts(id,author,body,category,images,created) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),me.id,'ランチの発見 '+i+' 😊 Coffee',i<3?'お知らせ':'日々のこと','[]',i).run();
  const search=async(q,extra='')=>await(await request('/api/posts?q='+encodeURIComponent(q)+extra)).json();
  const first=await search('ランチ');assert.equal(first.posts.length,20);assert.equal(first.more,true);assert.equal(first.total,23);
  const second=await search('ランチ','&offset=20');assert.equal(second.posts.length,3);assert.equal(second.more,false);assert.equal(second.total,23);assert.equal(new Set([...first.posts,...second.posts].map(p=>p.id)).size,23);
  assert.equal((await search('😊')).total,23);assert.equal((await search('coffee')).total,23);assert.equal((await search('  発見  ')).total,23);
  assert.equal((await search('NameOnlyKeyword')).total,0);assert.equal((await search("' OR 1=1 --")).total,0);
  assert.equal((await search('ランチ','&category='+encodeURIComponent('お知らせ'))).total,3);
  assert.equal((await search('ランチ','&mode=mine')).total,23);assert.equal((await search('ランチ','&mode=liked')).total,0);
  assert.equal((await request('/api/posts?q=ランチ',{authenticated:false})).status,401);
  const form=new FormData();form.set('body','ありがとう😊✨');form.append('images',new File([fs.readFileSync('public/icon-192.png')],'sticker.png',{type:'image/png'}));
  assert.equal((await request('/api/posts',{method:'POST',body:form})).status,201);
  const saved=(await search('ありがとう😊')).posts[0];assert.equal(saved.body,'ありがとう😊✨');assert.equal(saved.images.length,1);
  assert.equal((await request('/media/'+saved.images[0],{authenticated:false})).status,401);assert.equal((await request('/media/'+saved.images[0])).headers.get('content-type'),'image/png');
  const onlySticker=new FormData();onlySticker.append('images',new File([fs.readFileSync('public/icon-192.png')],'sticker.png',{type:'image/png'}));assert.equal((await request('/api/posts',{method:'POST',body:onlySticker})).status,201);
  const overLimit=new FormData();for(let i=0;i<5;i++)overLimit.append('images',new File([fs.readFileSync('public/icon-192.png')],'sticker.png',{type:'image/png'}));assert.equal((await request('/api/posts',{method:'POST',body:overLimit})).status,400);
 }finally{env.sqlite.close()}
});
