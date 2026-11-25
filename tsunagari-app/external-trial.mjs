import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openTrialBrowser} from './launcher-utils.mjs';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24 or later is required.');
let tunnel,app,targetPort=0,origin='',buffer='',stopping=false,exitCode=0;
// Keep the forwarding port bound to this process. Before our app is ready it
// only serves 503; it never points a public tunnel at an unrelated local service.
const proxy=http.createServer((req,res)=>{
 if(!targetPort){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('SNS is starting. Please try again shortly.');return}
 const upstream=http.request({hostname:'127.0.0.1',port:targetPort,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('SNS is unavailable.');});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
const timeout=setTimeout(()=>stop(1,'Tunnel startup timed out. Check network access and cloudflared settings.'),60000);
function stop(code=0,message){if(stopping)return;stopping=true;exitCode=code;targetPort=0;clearTimeout(timeout);if(message)console.error(message);tunnel?.kill();app?.kill();proxy.close();proxy.closeAllConnections();setTimeout(()=>process.exit(exitCode),300).unref()}
function startApp(url){
 origin=url;
 app=spawn(process.execPath,['server.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,PUBLIC_ORIGIN:origin,NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',TUNNEL_CHILD:'1',DATA_DIRECTORY:process.env.DATA_DIRECTORY||'data-external-trial'}});
 app.on('error',()=>stop(1,'Could not start the SNS server.'));
 app.stderr.on('data',chunk=>process.stderr.write(chunk));
 app.stdout.on('data',()=>{});
 app.on('message',async message=>{
  if(message?.type!=='ready'||!Number.isInteger(message.port)||message.port<1||message.port>65535)return;
  targetPort=message.port;
  try{
   const status=await fetch(`http://127.0.0.1:${targetPort}/api/auth/status`).then(r=>{if(!r.ok)throw Error();return r.json()});
   const posts=await fetch(`http://127.0.0.1:${targetPort}/api/posts`);
   if(posts.status!==401)throw Error('Unauthenticated access was not blocked.');
   if(status.setupRequired&&!status.setupConfigured)throw Error('First run requires a private initial setup code of 32 or more characters.');
   clearTimeout(timeout);
   console.log('\nTrial URL: '+origin+'\nOpen this URL in your browser. First register the admin, then issue invites.\nData folder: '+path.resolve(process.env.DATA_DIRECTORY||'data-external-trial')+'\nKeep this window and PC running. Ctrl+C stops external access.\nThis is a temporary test URL, not a production service.');
   if(process.env.OPEN_BROWSER==='1')openTrialBrowser(origin);
  }catch(e){stop(1,e.message||'The local SNS checks failed.')}
 });
 app.on('exit',()=>{if(!stopping)stop(1,'The SNS server stopped; the tunnel has been closed.')});
}
function tunnelOutput(chunk){
 buffer=(buffer+chunk.toString()).slice(-16384);
 if(!origin){const found=buffer.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?=[\s/]|$)/i);if(found)startApp(found[0])}
}
proxy.on('error',()=>stop(1,'Could not open a local forwarding port.'));
proxy.listen(0,'127.0.0.1',()=>{
 const tunnelEnv={...process.env};delete tunnelEnv.ADMIN_SETUP_TOKEN;
 tunnel=spawn('cloudflared',['tunnel','--url',`http://127.0.0.1:${proxy.address().port}`,'--no-autoupdate'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:tunnelEnv});
 tunnel.stdout.on('data',tunnelOutput);tunnel.stderr.on('data',tunnelOutput);
 tunnel.on('error',()=>stop(1,'cloudflared was not found or could not start. Install it from Cloudflare, then reopen PowerShell.'));
 tunnel.on('exit',()=>{if(!stopping)stop(1,'The tunnel stopped. Check cloudflared installation, outbound network access, and any existing cloudflared configuration.')});
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
process.on('uncaughtException',e=>stop(1,e.message));
process.on('unhandledRejection',e=>stop(1,e?.message||'External trial failed.'));
