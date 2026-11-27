import fs from 'node:fs';
import path from 'node:path';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const assets={};for(const name of fs.readdirSync('public')){const ext=path.extname(name),base64=ext==='.png';assets[name==='index.html'?'/':'/'+name]={body:fs.readFileSync('public/'+name,base64?'base64':'utf8'),type:types[ext],base64}}
assets['/admin']=assets['/admin.html'];assets['/admin/']=assets['/admin.html'];
fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
const auth=fs.readFileSync('auth.mjs','utf8').replaceAll('export async function','async function');
const profile=fs.readFileSync('profile-api.mjs','utf8').replaceAll('export async function','async function');
const calendar=fs.readFileSync('calendar-api.mjs','utf8').replaceAll('export async function','async function');
const announcement=fs.readFileSync('announcement-api.mjs','utf8').replaceAll('export async function','async function').replace("import {notifyMembers} from './push-api.mjs';",'');
const video=fs.readFileSync('video-media.mjs','utf8').replaceAll('export async function','async function').replaceAll('export function','function');
const push=fs.readFileSync('push-api.mjs','utf8').replaceAll('export async function','async function').replaceAll('export function','function');
const moderationCore=fs.readFileSync('moderation-core.mjs','utf8').replaceAll('export async function','async function').replaceAll('export function','function');
const moderation=fs.readFileSync('moderation-api.mjs','utf8').replaceAll('export async function','async function').replace(/^import .*from '.\/moderation-core.mjs';/m,'');
const operations=fs.readFileSync('operations-api.mjs','utf8').replaceAll('export async function','async function');
const source=fs.readFileSync('worker.mjs','utf8').replace("import {handleOperations,observeOperation} from './operations-api.mjs';",()=>operations).replace("import {handleModeration} from './moderation-api.mjs';",()=>moderation).replace("import {moderationLock,removeModeratedContent,flushMediaDeletions} from './moderation-core.mjs';",()=>moderationCore).replace("import {assets} from './assets.mjs';",()=> 'const assets='+JSON.stringify(assets)+';').replace("import {identity,handleAuth,pushSession} from './auth.mjs';",()=>auth).replace("import {handleProfiles} from './profile-api.mjs';",()=>profile).replace("import {handleCalendar} from './calendar-api.mjs';",()=>calendar);
fs.writeFileSync('dist/server/index.js',source.replace("import {handleAnnouncement} from './announcement-api.mjs';",()=>announcement).replace("import {validateVideo,serveVideo} from './video-media.mjs';",()=>video).replace("import {handlePush,notifyMembers} from './push-api.mjs';",()=>push));if(fs.existsSync('.openai/hosting.json'))fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');console.log('Built dependency-free Worker with '+Object.keys(assets).length+' assets.');

