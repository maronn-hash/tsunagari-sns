import http from 'node:http';import worker from './dist/server/index.js';import {createStorage} from './node-storage.mjs';
import {createPushService} from './node-push.mjs';
import {createContentMaintenance} from './node-moderation.mjs';
import {serverConfiguration} from './server-config.mjs';
const {port,origin,host,localDev}=serverConfiguration();
const env=createStorage(process.env.DATA_DIRECTORY||'data');env.ADMIN_SETUP_TOKEN=process.env.ADMIN_SETUP_TOKEN;env.LOCAL_DEV=localDev;
if(!localDev){try{env.PUSH=createPushService({env,directory:process.env.DATA_DIRECTORY||'data',origin})}catch{console.error('Push notifications unavailable. Check data directory and push-keys.json.')}}
const contentMaintenance=createContentMaintenance(env);
const server=http.createServer(async(req,res)=>{try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>21000000){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'ファイルが大きすぎます。'}));return}chunks.push(c)}const headers=new Headers(req.headers);headers.set('cf-connecting-ip',req.socket.remoteAddress||'unknown');const result=await worker.fetch(new Request(origin+req.url,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined}),env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()))}catch(e){console.error('Request failed:',e.message);res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'処理できませんでした。'}))}});
server.listen(port,host,()=>{console.log('Tsunagari: '+origin);if(process.send)process.send({type:'ready',port:server.address().port})});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await contentMaintenance.close();await env.PUSH?.close();env.close();process.exit(0)}));
