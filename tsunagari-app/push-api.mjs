const pushJson=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const pushFail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
export function validPushEndpoint(value){
 if(typeof value!=='string'||value.length>2048)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.pathname!=='/'&&(u.hostname==='web.push.apple.com'||u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.push.services.mozilla.com'))}catch{return false}
}
export function pushPreview({name='',body='',images=[],kind='post',postId='',commentId=''}={}){
 const clip=(value,max)=>{const chars=Array.from(String(value).replace(/\s+/g,' ').trim());return chars.length>max?chars.slice(0,max).join('')+'…':chars.join('')};
 const author=clip(name,40)||'メンバー';
 const title=kind==='reply'?`${author}さんが返信しました`:kind==='announcement'?`${author}さんが固定コメントを更新`:kind==='test'?`${author}さんのテスト通知`:`${author}さんが投稿しました`;
 const attachment=images.some(k=>k.endsWith('.mp4'))?'🎥 動画':images.length?`📷 画像${images.length}枚`:'';
 const preview=clip(body,100);
 return {title,body:[preview,attachment].filter(Boolean).join(' '),url:/^[a-f0-9-]{36}$/.test(postId)?'/?post='+postId:'/',version:1,...(/^[a-f0-9-]{36}$/.test(commentId)?{commentId}:{})};
}
async function readPushKeys(keys){
 if(keys===undefined)return {p256dh:'',auth:''}; // Earlier clients retain their generic notifications.
 const decode=(value,length)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))pushFail('通知の暗号化情報が正しくありません。登録し直してください。');let bytes;try{bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}catch{pushFail('通知の暗号化情報が正しくありません。')}if(bytes.length!==length)pushFail('通知の暗号化情報が正しくありません。');return bytes};
 const publicKey=decode(keys?.p256dh,65);decode(keys?.auth,16);
 try{await crypto.subtle.importKey('raw',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[])}catch{pushFail('通知の暗号化情報が正しくありません。登録し直してください。')}
 return {p256dh:keys.p256dh,auth:keys.auth};
}
export async function handlePush(req,env,user,sessionHash){
 const p=new URL(req.url).pathname;if(!p.startsWith('/api/push/'))return null;
 if(p==='/api/push/config'&&req.method==='GET'){
  const rows=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=? AND session_hash=?').bind(user.id,sessionHash).all();
  return pushJson({available:!!env.PUSH,publicKey:env.PUSH?.publicKey||'',subscribed:!!rows.results.length,endpoints:rows.results.map(row=>row.endpoint),detailEndpoints:rows.results.filter(row=>row.p256dh&&row.auth).map(row=>row.endpoint)});
 }
 if(!env.PUSH)pushFail('通知は固定URLで起動したNode.js版で利用できます。',503);
 if(p==='/api/push/subscription'&&['POST','DELETE'].includes(req.method)){
  let b;try{b=await req.json()}catch{pushFail('通知の設定を読み取れません。')}
  if(!validPushEndpoint(b?.endpoint))pushFail('このブラウザーの通知先には対応していません。');
  if(req.method==='DELETE'){await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').bind(b.endpoint,user.id).run();return pushJson({ok:true})}
  const keys=await readPushKeys(b.keys);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.token_hash=push_subscriptions.session_hash AND s.expires>?)').bind(Date.now()).run();
  const count=await env.DB.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id=?').bind(user.id).first();
  if(count.n>=10&&!await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint=? AND user_id=?').bind(b.endpoint,user.id).first())pushFail('登録できる通知端末は10台までです。',400);
  await env.DB.batch([env.DB.prepare('DELETE FROM push_jobs WHERE endpoint=?').bind(b.endpoint),env.DB.prepare('INSERT INTO push_subscriptions(endpoint,user_id,session_hash,created,p256dh,auth) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash,created=excluded.created,p256dh=excluded.p256dh,auth=excluded.auth').bind(b.endpoint,user.id,sessionHash,Date.now(),keys.p256dh,keys.auth)]);
  return pushJson({ok:true});
 }
 if(p==='/api/push/test'&&req.method==='POST'){
  let b;try{b=await req.json()}catch{pushFail('通知の設定を読み取れません。')}
  if(!validPushEndpoint(b?.endpoint))pushFail('通知をオンにしてから、もう一度お試しください。');
  const result=await env.PUSH.test({userId:user.id,sessionHash,endpoint:b.endpoint,payload:pushPreview({name:user.name,kind:'test',body:'名前と本文が表示される通知のテストです。'})});
  return pushJson(result);
 }
 pushFail('対応していない操作です。',405);
}
export async function notifyMembers(env,options){
 if(!env.PUSH)return;
 try{await env.PUSH.enqueue({...options,payload:pushPreview(options)})}catch{console.error('Notification queue failed. The SNS content was saved.')}
}
