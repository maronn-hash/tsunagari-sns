import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export const PRIVATE_FOLDER='.sns-private';
export function validateOrigin(value){
 const text=String(value??'').trim();
 if(!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ngrok-free\.(?:app|dev)\/?$/i.test(text))throw Error('ngrokのDomains画面にある https://...ngrok-free.dev または .app のURLを入力してください。');
 return new URL(text).origin;
}
export function validateToken(value){
 const token=String(value??'').trim();
 if(token.length<10||token.length>1024||/\s|[\x00-\x1f\x7f]/.test(token))throw Error('Authtokenが空、または形式が正しくありません。ngrokの管理画面で確認してください。');
 return token;
}
export function saveConfig(root,config){
 const clean={origin:validateOrigin(config.origin),authtoken:validateToken(config.authtoken)};
 const folder=path.join(root,PRIVATE_FOLDER);fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const file=path.join(folder,'fixed-url.json'),temp=file+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(clean,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);
 return clean;
}
export function readConfig(root){
 let value;
 try{value=JSON.parse(fs.readFileSync(path.join(root,PRIVATE_FOLDER,'fixed-url.json'),'utf8'))}catch{throw Error('固定URLの設定がありません。setup-fixed-url.cmd を先に開いてください。')}
 return {origin:validateOrigin(value?.origin),authtoken:validateToken(value?.authtoken)};
}
export function cleanEnvironment(env=process.env){
 return Object.fromEntries(Object.entries(env).filter(([key])=>!/^NGROK_/i.test(key)&&!/^ADMIN_SETUP_TOKEN$/i.test(key)));
}
export function agentOptions(root,port,config,env=process.env){
 const origin=validateOrigin(config.origin),authtoken=validateToken(config.authtoken);
 const folder=path.join(root,PRIVATE_FOLDER);fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const file=path.join(folder,'ngrok.yml');
 fs.writeFileSync(file,'version: 3\nagent:\n  web_addr: false\n',{mode:0o600});
 return {args:['http',`http://127.0.0.1:${port}`,`--url=${origin}`,`--config=${file}`,'--inspect=false','--log=stdout','--log-format=json'],env:{...cleanEnvironment(env),NGROK_AUTHTOKEN:authtoken}};
}
export function openFixedBrowser(origin){
 validateOrigin(origin);if(process.platform!=='win32')return;
 const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',origin],{windowsHide:true,stdio:'ignore',env:cleanEnvironment()});
 child.on('error',()=>console.error('ブラウザーを開けませんでした。表示された固定URLを手動で開いてください。'));child.unref();
}
