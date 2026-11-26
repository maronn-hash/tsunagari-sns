import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import worker from './dist/server/index.js';
import {createStorage} from './node-storage.mjs';
import {validateOrigin,saveConfig,readConfig,agentOptions,cleanEnvironment} from './fixed-url-config.mjs';
import {createFixedTunnel,checkPublic} from './fixed-tunnel-core.mjs';

const config={origin:'https://test-fixed-sns.ngrok-free.dev',authtoken:'test-only-not-a-real-token'};
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'tsunagari-fixed-'))}
function remove(directory){assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true})}

test('fixed URL config persists, rejects unsafe URLs, and isolates secrets from argv and app environment',()=>{
 const root=temporary();
 try{
  assert.throws(()=>readConfig(root));saveConfig(root,config);assert.deepEqual(readConfig(root),config);
  assert.equal(validateOrigin(config.origin+'/'),config.origin);
  assert.equal(validateOrigin('https://test.ngrok-free.app'),'https://test.ngrok-free.app');
  for(const url of ['http://test.ngrok-free.dev','https://user@test.ngrok-free.dev','https://test.ngrok-free.dev:443','https://test.ngrok-free.dev/path','https://test.ngrok-free.dev?x=y','https://test.ngrok-free.dev.evil.test','https://x.trycloudflare.com','https://test.ngrok-free.dev/#a'])assert.throws(()=>validateOrigin(url));
  assert.throws(()=>saveConfig(root,{...config,authtoken:'invalid token'}));assert.deepEqual(readConfig(root),config);
  const env={PATH:'path',ADMIN_SETUP_TOKEN:'secret',ngrok_api_key:'key',NGROK_AUTHTOKEN:'old'};
  assert.deepEqual(cleanEnvironment(env),{PATH:'path'});
  const options=agentOptions(root,12345,config,env);
  assert.ok(options.args.includes('--url='+config.origin));assert.ok(!options.args.join(' ').includes(config.authtoken));
  assert.equal(options.env.NGROK_AUTHTOKEN,config.authtoken);assert.equal(options.env.ADMIN_SETUP_TOKEN,undefined);
  assert.equal(fs.readFileSync(path.join(root,'.sns-private','ngrok.yml'),'utf8').includes(config.authtoken),false);
 }finally{remove(root)}
});

test('fixed tunnel uses existing data and login sessions across restarts; errors close owned resources',async()=>{
 const root=temporary(),directory=path.join(root,'data-external-trial');let runtime;
 try{
  for(const file of ['server.mjs','server-config.mjs','node-storage.mjs','node-push.mjs','node-moderation.mjs','moderation-core.mjs','push-encryption.mjs','push-api.mjs','drizzle','dist'])fs.cpSync(file,path.join(root,file),{recursive:true});
  const storage=createStorage(directory);storage.ADMIN_SETUP_TOKEN='test-fixed-bootstrap-code-over-32-characters';
  const registration=await worker.fetch(new Request(config.origin+'/api/auth/register',{method:'POST',headers:{origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',name:'Test',password:'test-password-long-enough',code:storage.ADMIN_SETUP_TOKEN})}),storage);
  assert.equal(registration.status,201);const cookie=registration.headers.get('set-cookie').split(';')[0];storage.close();
  let proxyPort,agent,killed=false,failed;
  const spawnAgent=(exe,args,options)=>{
   assert.equal(options.env.NGROK_AUTHTOKEN,config.authtoken);assert.ok(args.includes('--url='+config.origin));
   agent=new EventEmitter();agent.stdout=new PassThrough();agent.stderr=new PassThrough();agent.kill=()=>{killed=true;queueMicrotask(()=>agent.emit('exit',0))};return agent;
  };
  const probe=async({probePath,nonce,proxyPort:port,signal})=>{
   proxyPort=port;
   return checkPublic({origin:`http://127.0.0.1:${port}`,probePath,nonce,signal});
  };
  const start=()=>createFixedTunnel({root,directory,config,spawnAgent,probe,timeoutMs:10000,onFailure:error=>{failed=error}});
  const request=(url,method='GET',body)=>fetch(`http://127.0.0.1:${proxyPort}`+url,{method,headers:{cookie,origin:config.origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  runtime=start();assert.equal((await runtime.ready).origin,config.origin);
  assert.equal((await fetch(`http://127.0.0.1:${proxyPort}/api/posts`)).status,401);
  const form=new FormData();form.set('body','restart persistence');
  const post=await fetch(`http://127.0.0.1:${proxyPort}/api/posts`,{method:'POST',headers:{cookie,origin:config.origin},body:form});assert.equal(post.status,201);
  assert.equal((await request('/api/events','POST',{title:'Saved event',event_date:'2026-11-20',start_time:'',end_time:'',notes:''})).status,201);
  const badOrigin=await fetch(`http://127.0.0.1:${proxyPort}/api/posts`,{method:'POST',headers:{cookie,origin:'https://wrong.ngrok-free.dev','Content-Type':'application/json'},body:JSON.stringify({text:'blocked'})});assert.equal(badOrigin.status,403);
  runtime.close();assert.equal(killed,true);await delay(250);
  killed=false;runtime=start();assert.equal((await runtime.ready).origin,config.origin);
  assert.match(await(await request('/api/posts')).text(),/restart persistence/);
  assert.match(await(await request('/api/events?month=2026-11')).text(),/Saved event/);
  agent.stderr.write('do not echo token '+config.authtoken+' ERR_NGROK_108');agent.emit('exit',1);
  assert.match(failed.message,/ERR_NGROK_108/);assert.ok(!failed.message.includes(config.authtoken));assert.equal(killed,true);
  await assert.rejects(()=>fetch(`http://127.0.0.1:${proxyPort}/api/auth/status`));
  await delay(250);
  // A reachable but incorrect public response never reports ready.
  runtime=createFixedTunnel({root,directory,config,spawnAgent,probe:async()=>false,timeoutMs:1500});
  await assert.rejects(runtime.ready,/時間内/);
  // No registered data: fail before starting any external agent or creating a DB.
  runtime=createFixedTunnel({root,directory:path.join(root,'missing'),config,spawnAgent:()=>assert.fail('must not start tunnel')});
  await assert.rejects(runtime.ready,/登録済み/);assert.equal(fs.existsSync(path.join(root,'missing')),false);
 }finally{runtime?.close();await delay(300);remove(root)}
});
