import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {agentOptions,cleanEnvironment,validateOrigin} from './fixed-url-config.mjs';
import {needsInitialSetup} from './launcher-utils.mjs';

export async function checkPublic({origin,probePath,nonce,signal}){
 const response=await fetch(origin+probePath,{headers:{'ngrok-skip-browser-warning':'tsunagari-startup'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
 return response.status===200&&await response.text()===nonce;
}

// Each run owns both its forwarding socket and its application process.
// A remote probe must reach this run before the URL is reported as ready.
export function createFixedTunnel({root,directory,config,executable='ngrok',spawnAgent=spawn,probe=checkPublic,timeoutMs=60000,onFailure=()=>{},env=process.env}){
 let app,tunnel,targetPort=0,closed=false,readySent=false,probeEnabled=true,resolveReady,rejectReady,agentCode='';
 const origin=validateOrigin(config.origin),nonce=randomBytes(24).toString('hex');
 const probePath='/.well-known/tsunagari-ready/'+randomBytes(24).toString('hex');
 const controller=new AbortController();
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});
 const proxy=http.createServer((req,res)=>{
  if(probeEnabled&&targetPort&&req.method==='GET'&&req.url===probePath){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(nonce);return}
  if(!targetPort){res.writeHead(503);res.end('SNS is starting.');return}
  const upstream=http.request({hostname:'127.0.0.1',port:targetPort,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('SNS is unavailable.')});
  upstream.setTimeout(30000,()=>upstream.destroy());
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 const timer=setTimeout(()=>fail('固定URLへの接続確認が時間内に完了しませんでした。URL・トークン・ネット接続を確認してください。'+agentCode),timeoutMs);
 function close(){
  if(closed)return;closed=true;targetPort=0;clearTimeout(timer);controller.abort();
  tunnel?.kill();app?.kill();proxy.close();proxy.closeAllConnections();
  if(!readySent)rejectReady(Error('起動を停止しました。'));
 }
 function fail(message){
  if(closed)return;
  const error=Error(message);if(!readySent)rejectReady(error);else onFailure(error);
  close();
 }
 function observeLog(chunk){
  // Never echo provider logs, which may contain configuration or credentials.
  const code=String(chunk).match(/\bERR_NGROK_\d+\b/);if(code)agentCode=' ('+code[0]+')';
 }
 async function startAgent(){
  try{
   const status=await fetch(`http://127.0.0.1:${targetPort}/api/auth/status`,{signal:controller.signal}).then(r=>r.json());
   const posts=await fetch(`http://127.0.0.1:${targetPort}/api/posts`,{signal:controller.signal});
   if(status.setupRequired||posts.status!==401)throw Error('ログイン制限または保存データの確認に失敗しました。');
   if(closed)return;
   const options=agentOptions(root,proxy.address().port,config,env);
   tunnel=spawnAgent(executable,options.args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:options.env});
   tunnel.on('error',()=>fail('ngrokを起動できません。FIXED_URL.md の導入手順を確認してください。'));
   tunnel.stdout?.on('data',observeLog);tunnel.stderr?.on('data',observeLog);
   tunnel.on('exit',()=>fail('ngrokが停止しました。URL・Authtoken・同じURLを使う別の起動を確認してください。'+agentCode));
   while(!closed){
    let ok=false;
    try{ok=await probe({origin,probePath,nonce,proxyPort:proxy.address().port,signal:controller.signal})}catch{/* retry until bounded startup deadline */}
    if(closed)return;
    if(ok){probeEnabled=false;readySent=true;clearTimeout(timer);resolveReady({origin});return}
    await delay(1000,undefined,{signal:controller.signal});
   }
  }catch(error){if(!closed)fail(error.message||'SNSの起動確認に失敗しました。')}
 }
 proxy.on('error',()=>fail('ローカル転送ポートを開けませんでした。'));
 queueMicrotask(()=>{
  try{
   if(closed)return;
   if(needsInitialSetup(directory))throw Error('登録済みアカウントが見つかりません。元の data-external-trial があるフォルダーから起動してください。初回登録は HOME_SERVER.md を確認してください。');
   proxy.listen(0,'127.0.0.1',()=>{
    if(closed)return;
    app=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...cleanEnvironment(env),PUBLIC_ORIGIN:origin,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',TUNNEL_CHILD:'1',DATA_DIRECTORY:directory}});
    app.on('error',()=>fail('SNSサーバーを起動できませんでした。'));
    app.on('exit',()=>fail('SNSサーバーが停止しました。データフォルダーと起動環境を確認してください。'));
    app.on('message',message=>{
     if(closed||targetPort||message?.type!=='ready'||!Number.isInteger(message.port)||message.port<1||message.port>65535)return;
     targetPort=message.port;void startAgent();
    });
   });
  }catch(error){fail(error.message)}
 });
 return {ready,close};
}
