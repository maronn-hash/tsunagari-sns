import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from './dist/server/index.js';
import {createEnv} from './local-adapter.mjs';
function ui(){
 const html=fs.readFileSync('public/admin.html','utf8'),elements=new Map();for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))elements.set('#'+id,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,disabled:false,onclick:null,addEventListener(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false},reset(){},replaceChildren(){},classList:{toggle(){}},focus(){}});
 const $=s=>elements.get(s)||null,calls=[],context={document:{querySelector:$,querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible'},window:{addEventListener(){}},location:{hash:''},Headers,Request,URLSearchParams,Intl,Date,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},navigator:{},confirm:()=>true,fetch:async(url,options)=>{calls.push(url);return new Response(JSON.stringify({error:'not logged in'}),{status:401})}};
 vm.createContext(context);const run=s=>vm.runInContext(s,context);for(const [,src] of html.matchAll(/<script src="\/([^"]+)" defer>/g)){if(src!=='admin-start.js')run(fs.readFileSync('public/'+src,'utf8'))}return {$,context,run,calls,html};
}
test('dedicated admin routes serve a login shell; SNS contains only the new-tab admin link and member reports',async()=>{
 const env=createEnv();try{for(const url of ['/admin','/admin/','/admin.html']){const r=await worker.fetch(new Request('https://sns.test'+url),env);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(await r.text(),/id="admin-login"/)}
 const r=await worker.fetch(new Request('https://sns.test/api/admin/operations/status'),env);assert.equal(r.status,401);
 const sns=fs.readFileSync('public/index.html','utf8');assert.match(sns,/id="open-admin-console"[^>]*href="\/admin"[^>]*target="_blank"[^>]*rel="noopener"[^>]*hidden/);assert.ok(sns.includes('id="report-dialog"'));for(const id of ['admin-dialog','operations-dialog','moderation-dialog','mod-action-dialog'])assert.ok(!sns.includes('id="'+id+'"'));assert.ok(!sns.includes('src="/operations.js"'));assert.ok(!sns.includes('src="/moderation.js"'));
 }finally{env.sqlite.close()}
});
test('all dedicated page scripts initialize with real DOM ids and reject non-admin sessions',async()=>{
 const {$,context,run,calls}=ui();context.fetch=async url=>{calls.push(url);return new Response(JSON.stringify({id:'member',role:'member',name:'一般メンバー'}))};
 assert.equal(await run('authenticateAdmin(true)'),false);assert.equal($('#admin-shell').hidden,true);assert.equal($('#admin-login').hidden,false);assert.match($('#admin-login-error').textContent,/管理者だけ/);assert.deepEqual(calls,['/api/me']);
 $('#open-admin').onclick();$('#open-moderation').onclick();$('#open-operations').onclick();assert.equal($('#admin-dialog').open,false);assert.equal($('#moderation-dialog').open,false);assert.equal($('#operations-dialog').open,false);
});
test('admin session opens management, escapes names and clears privileged data on logout or stale requests',async()=>{
 const {$,context,run}=ui();context.fetch=async url=>{
 const data=url==='/api/me'?{id:'admin',role:'admin',name:'<script>管理者</script>'}:url.startsWith('/api/events')?{events:[]}:url==='/api/announcement'?{body:'連絡'}:url==='/api/admin/members'?[{id:'admin',name:'<img onerror=x>',username:'admin',role:'admin',enabled:1}]:{};return new Response(JSON.stringify(data));
 };
 assert.equal(await run('authenticateAdmin()'),true);assert.equal($('#admin-shell').hidden,false);await $('#open-admin').onclick();assert.equal($('#admin-dialog').open,true);assert.match($('#admin-members').innerHTML,/&lt;img/);assert.doesNotMatch($('#admin-members').innerHTML,/<img/);
 let release;context.fetch=()=>new Promise(r=>release=r);const pending=run('members()');run("lockAdmin('ログアウト')");release(new Response(JSON.stringify([{id:'other',name:'private'}])));await assert.rejects(pending,/ログイン状態/);assert.equal($('#admin-members').textContent,'');assert.equal($('#admin-shell').hidden,true);
});
test('normal reporting sends reports and provides admin links without exposing management to members',async()=>{
 const elements=new Map();const $=s=>{if(!elements.has(s))elements.set(s,{value:'',textContent:'',disabled:false,open:false,showModal(){this.open=true},close(){this.open=false}});return elements.get(s)};let click,request;
 const context={$,me:{id:'member',role:'member'},esc:s=>s,encodeURIComponent,document:{addEventListener:(n,f)=>{click=f}},window:{open(){}},api:async(url,options)=>{request={url,body:JSON.parse(options.body)};return {ok:true}},toast(){}};vm.createContext(context);vm.runInContext(fs.readFileSync('public/reporting.js','utf8'),context);const run=s=>vm.runInContext(s,context);
 assert.doesNotMatch(run("moderationLinks('post','abc')"),/\/admin/);context.me={id:'admin',role:'admin'};assert.match(run("moderationLinks('post','abc')"),/\/admin#moderation\?kind=post&amp;id=abc/);
 click({target:{closest:()=>({dataset:{reportKind:'post',reportId:'abc'}})}});$('#report-category').value='その他';$('#report-detail').value='確認をお願いします';await $('#report-form').onsubmit({preventDefault(){}});assert.equal(request.url,'/api/reports');assert.equal(request.body.id,'abc');assert.equal($('#report-dialog').open,false);
});
