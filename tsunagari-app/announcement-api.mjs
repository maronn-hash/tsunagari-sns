import {notifyMembers} from './push-api.mjs';
const announcementJson=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const announcementFail=(message,status)=>{throw Object.assign(Error(message),{status})};
export async function handleAnnouncement(req,env,user){
 if(new URL(req.url).pathname!=='/api/announcement')return null;
 if(req.method==='GET'){
  const row=await env.DB.prepare('SELECT body,updated FROM announcement WHERE id=1').first();
  return announcementJson(row||{body:'',updated:null});
 }
 if(req.method!=='PUT')announcementFail('対応していない操作です。',405);
 if(user.role!=='admin')announcementFail('固定コメントを変更できるのは管理者だけです。',403);
 let data;try{data=await req.json()}catch{announcementFail('入力内容を確認してください。',400)}
 if(typeof data?.body!=='string'||data.body.length>1000)announcementFail('固定コメントは1000文字以内で入力してください。',400);
 const body=data.body.trim(),updated=Date.now();
 await env.DB.prepare('INSERT INTO announcement(id,body,updated) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated=excluded.updated').bind(body,updated).run();
 if(body)await notifyMembers(env,{excludeUser:user.id,name:user.name,body,kind:'announcement'});
 return announcementJson({body,updated});
}
