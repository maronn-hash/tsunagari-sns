import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from './dist/server/index.js';
import {createEnv} from './local-adapter.mjs';

test('profile histories are private, author-filtered, paginated and exclude hidden/deleted posts and login IDs',async()=>{
 const env=createEnv();env.ADMIN_SETUP_TOKEN='profile-history-bootstrap-secret-32-characters';let seq=0;
 const req=(url,{cookie='',method='GET',body}={})=>worker.fetch(new Request('https://sns.test'+url,{method,headers:{cookie,origin:'https://sns.test','cf-connecting-ip':'192.0.2.'+(++seq),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);
 const cookie=r=>r.headers.get('set-cookie').split(';')[0];
 try{
  const a=cookie(await req('/api/auth/register',{method:'POST',body:{username:'alice-login-private',name:'Alice',password:'profile-history-password',code:env.ADMIN_SETUP_TOKEN}}));
  const invitation=await(await req('/api/admin/invites',{cookie:a,method:'POST',body:{username:'bob-login-private'}})).json();
  const b=cookie(await req('/api/auth/register',{method:'POST',body:{username:'bob-login-private',name:'Bob',password:'profile-history-password',code:invitation.code}}));
  const alice=await(await req('/api/me',{cookie:a})).json(),bob=await(await req('/api/me',{cookie:b})).json(),ids=[];
  for(let i=0;i<27;i++){const id=crypto.randomUUID();ids.push(id);await env.DB.prepare('INSERT INTO posts(id,author,body,category,images,created) VALUES (?,?,?,?,?,?)').bind(id,bob.id,i%2?'needle':'普通の投稿','日々のこと',JSON.stringify(i===26?[id+'/0.mp4']:i===25?[id+'/0.png']:[]),1000+i).run()}
  await env.DB.prepare('UPDATE posts SET hidden=1 WHERE id=?').bind(ids[24]).run();await env.DB.prepare('DELETE FROM posts WHERE id=?').bind(ids[23]).run();
  await env.DB.prepare('INSERT INTO posts(id,author,body,category,images,created) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),alice.id,'別の人の投稿','日々のこと','[]',9999).run();
  const endpoint='/api/posts?author='+bob.id;
  assert.equal((await req(endpoint)).status,401);assert.equal((await req('/api/posts?author=bad%27SQL',{cookie:a})).status,400);
  const page1=await(await req(endpoint,{cookie:a})).json(),page2=await(await req(endpoint+'&offset=20',{cookie:a})).json();
  assert.equal(page1.posts.length,20);assert.equal(page1.more,true);assert.equal(page1.total,25);assert.equal(page2.posts.length,5);assert.equal(page2.more,false);
  const all=[...page1.posts,...page2.posts];assert.equal(new Set(all.map(p=>p.id)).size,25);assert.ok(all.every(p=>p.author===bob.id&&!p.mine&&!p.hidden));assert.ok(!all.some(p=>[ids[23],ids[24]].includes(p.id)));assert.equal(page1.posts[0].id,ids[26]);assert.ok(page1.posts[0].images[0].endsWith('.mp4'));assert.ok(page1.posts[1].images[0].endsWith('.png'));
  const search=await(await req(endpoint+'&q=needle',{cookie:a})).json();assert.equal(search.total,12);assert.ok(search.posts.every(p=>p.body==='needle'&&p.author===bob.id));
  const own=await(await req(endpoint,{cookie:b})).json();assert.ok(own.posts.every(p=>p.mine));
  for(const target of [alice.id,bob.id]){const profile=await(await req('/api/profiles/'+target,{cookie:a})).json();assert.equal('username'in profile,false);assert.equal('password_hash'in profile,false);if(target===bob.id)assert.equal(profile.post_count,25)}
  assert.equal((await(await req('/api/me',{cookie:b})).json()).username,'bob-login-private');
  const unknown=await(await req('/api/posts?author='+crypto.randomUUID(),{cookie:a})).json();assert.equal(unknown.total,0);assert.equal(unknown.posts.length,0);
 }finally{env.sqlite.close()}
});

function ui(){
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,open:false,listeners:{},addEventListener(event,f){this.listeners[event]=f},setAttribute(){},removeAttribute(){},replaceChildren(){this.innerHTML='';this.textContent=''},reset(){},showModal(){this.open=true},close(){if(this.open){this.open=false;this.listeners.close?.()}},classList:{toggle(){}},focus(){}});return elements.get(id)};
 const context={document:{querySelector:$,querySelectorAll:()=>[]},window:{addEventListener(){}},URLSearchParams,URL,Intl,Date,console,setTimeout:()=>1,clearTimeout(){},fetch:()=>assert.fail('unexpected fetch')};vm.createContext(context);const run=s=>vm.runInContext(s,context);for(const script of ['app.js','profile-ui.js'])run(fs.readFileSync('public/'+script,'utf8'));run("me={id:'viewer',name:'自分',username:'private-self-id'}");return {$,context,run};
}
test('profile UI removes handles, displays media history and retries pagination without losing previous posts',async()=>{
 const {$,context,run}=ui();const requests=[];let fail=false;
 context.mockAPI=async url=>{requests.push(url);if(url.startsWith('/api/profiles/'))return {id:'target',name:'<script>名前</script>',username:'private-login-id',post_count:2,bio:'説明'};
  const offset=new URL('https://test'+url).searchParams.get('offset');if(offset==='1'&&fail)throw Error('接続失敗');return {posts:[{id:offset==='0'?'p1':'p2',created:1,body:'<script>投稿</script>',category:'日々のこと',images:offset==='0'?['aabbcc/0.png','aabbcc/1.mp4']:[],like_count:1,comment_count:2}],more:offset==='0',total:2}};
 run('api=mockAPI;updateMe()');assert.equal($('#side-handle').textContent,'');assert.equal($('#side-handle').hidden,true);
 await run("openProfileView('target')");assert.equal($('#profile-posts-section').hidden,false);assert.doesNotMatch($('#profile-view-content').innerHTML,/private-login-id|profile-handle/);assert.match($('#profile-view-content').innerHTML,/&lt;script&gt;/);
 assert.match($('#profile-posts-list').innerHTML,/&lt;script&gt;/);assert.match($('#profile-posts-list').innerHTML,/\/media\/aabbcc\/0.png/);assert.match($('#profile-posts-list').innerHTML,/<video controls/);assert.match($('#profile-posts-list').innerHTML,/href="\/\?post=p1"/);
 fail=true;await run('loadProfilePosts(true)');assert.equal(run('profilePosts.length'),1);assert.match($('#profile-posts-status').textContent,/接続失敗/);assert.equal($('#profile-posts-more').disabled,false);
 fail=false;await run('loadProfilePosts(true)');assert.equal(run('profilePosts.length'),2);assert.equal($('#profile-posts-more').hidden,true);assert.ok(requests.filter(s=>s.includes('offset=1')).length===2);
});

test('profile history ignores stale responses after changing profiles, closing or logging out',async()=>{
 const {$,context,run}=ui();let resolveOld;
 context.mockAPI=async url=>{if(url.startsWith('/api/profiles/'))return {id:url.split('/').at(-1),name:'名前',post_count:0};if(url.includes('author=first'))return new Promise(resolve=>{resolveOld=resolve});return {posts:[],more:false,total:0}};
 run('api=mockAPI');const first=run("openProfileView('first')");await new Promise(r=>setImmediate(r));await run("openProfileView('second')");resolveOld({posts:[{id:'old',body:'old private response'}],more:false});await first;assert.equal(run('profilePostsAuthor'),'second');assert.equal(run('profilePosts.length'),0);assert.match($('#profile-posts-status').textContent,/まだありません/);
 let resolve;context.mockAPI=()=>new Promise(r=>resolve=r);run('api=mockAPI');const pending=run('loadProfilePosts()');$('#profile-view-dialog').close();resolve({posts:[{id:'late'}],more:false});await pending;assert.equal($('#profile-posts-section').hidden,true);assert.equal(run('profilePosts.length'),0);
 run("profilePostsAuthor='second'");const afterLogout=run('loadProfilePosts()');run('me=null;resetProfileEditor()');resolve({posts:[{id:'private'}],more:false});await afterLogout;assert.equal($('#profile-posts-list').innerHTML,'');
});
