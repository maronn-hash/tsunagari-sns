import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';

// Read the same database used by the external launcher; never create a new one.
export function needsInitialSetup(directory){
 const file=path.join(directory,'sns.sqlite');
 if(!fs.existsSync(file))return true;
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get();
  return !table||db.prepare('SELECT count(*) AS count FROM accounts').get().count===0;
 }finally{db.close()}
}

export function isTrialURL(url){return typeof url==='string'&&/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/i.test(url)}

export function openTrialBrowser(url){
 if(process.platform!=='win32'||!isTrialURL(url))return;
 const env={...process.env};delete env.ADMIN_SETUP_TOKEN;
 // No shell: the URL cannot be interpreted as a command.
 const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore',env});
 child.on('error',()=>console.error('Could not open the browser. Open the Trial URL above manually.'));
 child.unref();
}
