import {handleOperations,observeOperation} from './operations-api.mjs';
import {assets} from './assets.mjs';
import {handleModeration} from './moderation-api.mjs';
import {moderationLock,removeModeratedContent,flushMediaDeletions} from './moderation-core.mjs';
import {identity,handleAuth,pushSession} from './auth.mjs';
import {handleProfiles} from './profile-api.mjs';
import {handleCalendar} from './calendar-api.mjs';
import {handleAnnouncement} from './announcement-api.mjs';
import {validateVideo,serveVideo} from './video-media.mjs';
import {handlePush,notifyMembers} from './push-api.mjs';
const categories=['日々のこと','仕事のヒント','お知らせ','ありがとう'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const text=(value,max)=>{if(typeof value!=='string'||value.trim().length>max)fail('入力内容が長すぎるか、形式が正しくありません。');return value.trim()};
export default {async fetch(req,env){const started=Date.now();let result,actor=null;
 if(new URL(req.url).pathname.startsWith('/api/')&&!['GET','HEAD'].includes(req.method))try{actor=await identity(req,env)}catch{}
 try{result=await handle(req,env)}catch(e){if(!e.status)console.error('Request failed');result=json({error:e.status?e.message:'処理できませんでした。時間をおいて、もう一度お試しください。'},e.status||500)}
 if(!actor&&result.status<400&&result.headers.has('set-cookie'))try{const headers=new Headers(req.headers);headers.set('cookie',result.headers.get('set-cookie').split(';')[0]);actor=await identity(new Request(req.url,{headers}),env)}catch{}
 await observeOperation(req,env,actor,result,Date.now()-started);return result}};
async function handle(req,env){
 const url=new URL(req.url),p=url.pathname;
 if(assets[p]&&req.method==='GET'){const a=assets[p];return new Response(a.base64?Uint8Array.from(atob(a.body),c=>c.charCodeAt(0)):a.body,{headers:{'Content-Type':a.type,'Cache-Control':p==='/sw.js'?'no-cache':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"}})}
 if(!p.startsWith('/api/')&&!p.startsWith('/media/'))return json({error:'見つかりません。'},404);
 const db=env.DB;
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('origin')!==url.origin)fail('この操作は許可されていません。',403);
 if(Number(req.headers.get('content-length')||0)>21000000)fail('画像のサイズが大きすぎます。',413);
 const authResponse=await handleAuth(req,env);if(authResponse)return authResponse;
 const user=await identity(req,env);
 const operationsResponse=await handleOperations(req,env,user);if(operationsResponse)return operationsResponse;
 const moderationResponse=await handleModeration(req,env,user);if(moderationResponse)return moderationResponse;
 const pushResponse=await handlePush(req,env,user,await pushSession(req,env));if(pushResponse)return pushResponse;
 if(p.startsWith('/media/')&&['GET','HEAD'].includes(req.method)){
  const key=p.slice(7);if(!/^[a-f0-9-]+\/\d+\.(jpg|png|webp|mp4)$/.test(key))fail('画像が見つかりません。',404);
  const post=await db.prepare('SELECT images,hidden FROM posts WHERE id=?').bind(key.split('/')[0]).first();
  const profile=await db.prepare('SELECT id FROM profiles WHERE avatar_key=? OR header_key=? LIMIT 1').bind(key,key).first();
  if((!post||(post.hidden&&user.role!=='admin')||!JSON.parse(post.images).includes(key))&&!profile)fail('画像が見つかりません。',404);
  const file=await env.BUCKET.get(key);if(!file)fail('画像が見つかりません。',404);
  if(key.endsWith('.mp4'))return serveVideo(file,req);
  return new Response(req.method==='HEAD'?null:file.body,{headers:{'Content-Type':file.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 await db.prepare('INSERT OR IGNORE INTO profiles (id,name) VALUES (?,?)').bind(user.id,user.name).run();
 const profileResponse=await handleProfiles(req,env,user);if(profileResponse)return profileResponse;
 const calendarResponse=await handleCalendar(req,env,user);if(calendarResponse)return calendarResponse;
 const announcementResponse=await handleAnnouncement(req,env,user);if(announcementResponse)return announcementResponse;
 if(p==='/api/posts'&&req.method==='GET'){
  const mode=url.searchParams.get('mode'),q=(url.searchParams.get('q')||'').trim().slice(0,100),cat=url.searchParams.get('category')||'',offset=Math.max(0,Math.min(100000,parseInt(url.searchParams.get('offset')||'0')||0));
  const filters=['p.hidden=0'],params=[user.id];
  const author=url.searchParams.get('author')||'';if(author){if(!/^[a-f0-9-]{36}$/.test(author))fail('投稿者が正しくありません。');filters.push('p.author=?');params.push(author)}
  const linked=url.searchParams.get('post');if(linked){if(!/^[a-f0-9-]{36}$/.test(linked))fail('投稿が見つかりません。',404);filters.push('p.id=?');params.push(linked)}
  if(mode==='mine'){filters.push('p.author=?');params.push(user.id)}
  if(mode==='liked'){filters.push('EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?)');params.push(user.id)}
  if(mode==='images')filters.push("p.images<>'[]' AND p.images NOT LIKE '%.mp4%'");
  if(q){filters.push("instr(lower(p.body),lower(?))>0");params.push(q)}
  if(categories.includes(cat)){filters.push('p.category=?');params.push(cat)}
  const where=filters.length?'WHERE '+filters.join(' AND '):'';
  const total=(q||author)?(await db.prepare('SELECT count(*) AS count FROM posts p JOIN profiles u ON u.id=p.author '+where).bind(...params.slice(1)).first()).count:null;
  const sql=`SELECT p.*,u.name,u.avatar_key,(SELECT count(*) FROM likes l WHERE l.post_id=p.id) AS like_count,(SELECT count(*) FROM comments c WHERE c.post_id=p.id AND c.hidden=0) AS comment_count,EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked FROM posts p JOIN profiles u ON u.id=p.author ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY p.created DESC,p.id DESC LIMIT 21 OFFSET ?`;
  const result=await db.prepare(sql).bind(...params,offset).all(),rows=result.results;return json({posts:rows.slice(0,20).map(r=>({...r,images:JSON.parse(r.images),mine:r.author===user.id})),more:rows.length>20,total});
 }
 if(p==='/api/posts'&&req.method==='POST'){
  const form=await req.formData(),body=text(form.get('body')||'',500),category=text(form.get('category')||'日々のこと',20),files=form.getAll('images'),videos=form.getAll('video');
  if(videos.length>1||(videos.length&&files.length))fail('動画は1本までで、写真・スタンプとは別に投稿してください。');
  if(!categories.includes(category)||files.length>4||(!body&&!files.length&&!videos.length))fail('本文または画像を追加してください。画像は4枚までです。');
  const validated=[];let total=0;
  if(videos.length){const f=videos[0];if(typeof f==='string'||f.size>20000000)fail('動画は20MB以内にしてください。');validated.push(validateVideo(new Uint8Array(await f.arrayBuffer())))}
  for(const f of files){if(typeof f==='string'||f.size>3000000)fail('画像は1枚3MB以内にしてください。');total+=f.size;if(total>12000000)fail('画像の合計は12MB以内にしてください。');const bytes=new Uint8Array(await f.arrayBuffer());let ext='';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)ext='png';if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')ext='webp';if(!ext)fail('JPEG・PNG・WebPの画像を選んでください。');validated.push({bytes,ext})}
  const id=crypto.randomUUID(),keys=[];try{for(let i=0;i<validated.length;i++){const f=validated[i],key=`${id}/${i}.${f.ext}`;await env.BUCKET.put(key,f.bytes,{httpMetadata:{contentType:f.ext==='mp4'?'video/mp4':'image/'+(f.ext==='jpg'?'jpeg':f.ext)}});keys.push(key)}await db.prepare('INSERT INTO posts (id,author,body,category,images,created) VALUES (?,?,?,?,?,?)').bind(id,user.id,body,category,JSON.stringify(keys),Date.now()).run()}catch(e){await Promise.allSettled(keys.map(k=>env.BUCKET.delete(k)));throw e}await notifyMembers(env,{excludeUser:user.id,name:user.name,body,images:keys,postId:id});return json({id},201);
 }
 const commentMatch=p.match(/^\/api\/posts\/([a-f0-9-]+)\/comments\/([a-f0-9-]+)$/);
 if(commentMatch&&req.method==='DELETE'){
  const comment=await db.prepare('SELECT author FROM comments WHERE id=? AND post_id=?').bind(commentMatch[2],commentMatch[1]).first();
  if(!comment)fail('コメントが見つかりません。',404);
  if(comment.author!==user.id)fail('自分のコメントだけ削除できます。',403);
  await moderationLock(env,()=>removeModeratedContent(env,{kind:'comment',id:commentMatch[2],actor:user,reason:'投稿者による削除',action:'author_delete'}));
  return json({ok:true});
 }
 const match=p.match(/^\/api\/posts\/([a-f0-9-]+)(?:\/(likes|comments))?$/);if(!match)fail('見つかりません。',404);
 const [,id,action]=match,post=await db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first();if(!post||(post.hidden&&!(req.method==='DELETE'&&!action&&post.author===user.id)))fail('投稿が見つかりません。',404);
 if(!action&&req.method==='DELETE'){
  if(post.author!==user.id)fail('自分の投稿だけ削除できます。',403);
  await moderationLock(env,async()=>{await removeModeratedContent(env,{kind:'post',id,actor:user,reason:'投稿者による削除',action:'author_delete'});await flushMediaDeletions(env)});return json({ok:true});
 }
 if(action==='likes'&&['PUT','DELETE'].includes(req.method)){await db.prepare(req.method==='PUT'?'INSERT OR IGNORE INTO likes (post_id,user_id) SELECT id,? FROM posts WHERE id=?':'DELETE FROM likes WHERE user_id=? AND post_id=?').bind(user.id,id).run();return json({ok:true})}
 if(action==='comments'&&req.method==='GET'){const r=await db.prepare('SELECT c.id,c.body,c.created,c.author,u.name,u.avatar_key FROM comments c JOIN profiles u ON u.id=c.author WHERE post_id=? AND c.hidden=0 ORDER BY c.created ASC LIMIT 200').bind(id).all();return json(r.results.map(c=>({...c,mine:c.author===user.id})))}
 if(action==='comments'&&req.method==='POST'){const b=await req.json(),body=text(b.body,300);if(!body)fail('コメントを入力してください。');const commentId=crypto.randomUUID();const inserted=await db.prepare('INSERT INTO comments (id,post_id,author,body,created) SELECT ?,id,?,?,? FROM posts WHERE id=? AND hidden=0').bind(commentId,user.id,body,Date.now(),id).run();if(!(inserted.changes??inserted.meta?.changes))fail('投稿が見つかりません。',404);if(post.author!==user.id)await notifyMembers(env,{onlyUser:post.author,name:user.name,body,kind:'reply',postId:id,commentId});return json({ok:true},201)}
 return json({error:'対応していない操作です。'},405);
}

