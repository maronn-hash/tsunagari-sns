import {moderationLock,moderationFailure,moderationReason,moderationTable,moderationAudit,cancelContentPush,removeModeratedContent,flushMediaDeletions} from './moderation-core.mjs';
const modJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function modBody(req){try{const b=await req.json();if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b}catch{moderationFailure('入力内容を確認してください。')}}
function modDays(value){if(![0,30,90,180,365,730].includes(value))moderationFailure('保存期間を選択してください。');return value}
export async function handleModeration(req,env,user){
 const url=new URL(req.url),p=url.pathname,db=env.DB,base='/api/admin/moderation';
 if(p!=='/api/reports'&&p!==base&&!p.startsWith(base+'/'))return null;
 if(p==='/api/reports'){
  if(req.method!=='POST')moderationFailure('対応していない操作です。',405);
  const b=await modBody(req),table=moderationTable(b.kind);
  if(typeof b.id!=='string'||!/^[a-f0-9-]{36}$/.test(b.id))moderationFailure('対象が正しくありません。');
  if(!['嫌がらせ・誹謗中傷','個人情報・機密情報','不適切な内容','迷惑投稿','その他'].includes(b.category)||typeof (b.detail??'')!=='string'||(b.detail||'').length>500)moderationFailure('通報理由を確認してください。');
  return moderationLock(env,async()=>{
   const row=await db.prepare(`SELECT * FROM ${table} WHERE id=? AND hidden=0`).bind(b.id).first();
   if(!row||(b.kind==='comment'&&!await db.prepare('SELECT id FROM posts WHERE id=? AND hidden=0').bind(row.post_id).first()))moderationFailure('対象が見つかりません。',404);
   const existing=await db.prepare('SELECT id FROM content_reports WHERE reporter=? AND target_type=? AND target_id=?').bind(user.id,b.kind,b.id).first();if(existing)return modJSON({ok:true,duplicate:true});
   const count=await db.prepare('SELECT count(*) AS n FROM content_reports WHERE reporter=? AND created>?').bind(user.id,Date.now()-86400000).first();if(count.n>=20)moderationFailure('1日に通報できる件数は20件までです。',429);
   await db.prepare('INSERT INTO content_reports(id,target_type,target_id,post_id,reporter,category,detail,created) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),b.kind,b.id,b.kind==='post'?b.id:row.post_id,user.id,b.category,(b.detail||'').trim(),Date.now()).run();return modJSON({ok:true},201);
  });
 }
 if(user.role!=='admin')moderationFailure('管理者だけが利用できます。',403);
 const offset=Math.max(0,Math.min(100000,parseInt(url.searchParams.get('offset')||'0',10)||0));
 if(p===base+'/content'&&req.method==='GET'){
  const kind=url.searchParams.get('kind')||'post',table=moderationTable(kind),state=url.searchParams.get('state')||'all',q=(url.searchParams.get('q')||'').trim().slice(0,100);
  if(!['all','hidden','visible'].includes(state))moderationFailure('表示条件を確認してください。');
  const filters=['(instr(lower(t.body),lower(?))>0 OR instr(lower(u.name),lower(?))>0)'],values=[q,q];
  const targetId=url.searchParams.get('id');if(targetId){if(!/^[a-f0-9-]{36}$/.test(targetId))moderationFailure('対象が正しくありません。');filters.push('t.id=?');values.push(targetId)}
  if(state!=='all'){filters.push('t.hidden=?');values.push(state==='hidden'?1:0)}
  const parent=kind==='comment'?',p.hidden AS parent_hidden':',0 AS parent_hidden';
  const join=kind==='comment'?' JOIN posts p ON p.id=t.post_id':'';
  const result=await db.prepare(`SELECT t.*,u.name${parent} FROM ${table} t JOIN profiles u ON u.id=t.author${join} WHERE ${filters.join(' AND ')} ORDER BY t.created DESC,t.id DESC LIMIT 26 OFFSET ?`).bind(...values,offset).all();
  return modJSON({items:result.results.slice(0,25).map(row=>({...row,kind,images:kind==='post'?JSON.parse(row.images):[]})),more:result.results.length>25});
 }
 if(p===base+'/reports'&&req.method==='GET'){
  const status=url.searchParams.get('status')||'open';if(!['open','resolved'].includes(status))moderationFailure('表示条件を確認してください。');
  const rows=await db.prepare("SELECT r.*,u.name AS reporter_name,CASE WHEN r.target_type='post' THEN p.body ELSE c.body END AS body,CASE WHEN r.target_type='post' THEN p.hidden ELSE c.hidden END AS hidden,CASE WHEN r.target_type='post' THEN p.images ELSE '[]' END AS images,COALESCE(a.name,'削除済み') AS author_name,p.hidden AS parent_hidden FROM content_reports r JOIN profiles u ON u.id=r.reporter LEFT JOIN posts p ON p.id=r.post_id LEFT JOIN comments c ON r.target_type='comment' AND c.id=r.target_id LEFT JOIN profiles a ON a.id=CASE WHEN r.target_type='post' THEN p.author ELSE c.author END WHERE r.status=? ORDER BY r.created DESC,r.id DESC LIMIT 26 OFFSET ?").bind(status,offset).all();
  return modJSON({items:rows.results.slice(0,25).map(r=>({...r,images:JSON.parse(r.images||'[]')})),more:rows.results.length>25});
 }
 if(p===base+'/audit'&&req.method==='GET'){
  const rows=await db.prepare('SELECT * FROM moderation_audit ORDER BY created DESC,id DESC LIMIT 26 OFFSET ?').bind(offset).all();return modJSON({items:rows.results.slice(0,25),more:rows.results.length>25});
 }
 if(p===base+'/retention'&&req.method==='GET'){
  const settings=await db.prepare('SELECT retention_days,updated FROM moderation_settings WHERE id=1').first();
  const days=url.searchParams.has('days')?modDays(Number(url.searchParams.get('days'))):settings.retention_days,cutoff=days?Date.now()-days*86400000:0;
  const posts=await db.prepare('SELECT count(*) AS n FROM posts WHERE created<?').bind(cutoff).first();
  const comments=await db.prepare('SELECT count(*) AS n FROM comments WHERE created<? OR post_id IN (SELECT id FROM posts WHERE created<?)').bind(cutoff,cutoff).first();
  const pending=await db.prepare('SELECT count(*) AS n FROM media_deletions').first();
  return modJSON({...settings,preview_days:days,posts:posts.n,comments:comments.n,pending_media:pending.n,automatic:!!env.CONTENT_MAINTENANCE});
 }
 if(p===base+'/retention'&&req.method==='PUT'){
  const b=await modBody(req),days=modDays(b.days),reason=moderationReason(b.reason);if(days&&b.confirm!==true)moderationFailure('保存期間を過ぎた投稿・返信と添付ファイルの削除に同意してください。');
  if(days&&!env.CONTENT_MAINTENANCE)moderationFailure('自動削除はNode.jsサーバーで利用できます。',503);
  return moderationLock(env,async()=>{const now=Date.now();await db.batch([moderationAudit(db,user,'retention_setting','settings','1',`保存期間: ${days||'無期限'}${days?'日':''}。${reason}`,now),db.prepare('UPDATE moderation_settings SET retention_days=?,updated=? WHERE id=1').bind(days,now)]);return modJSON({ok:true})});
 }
 const target=p.match(/^\/api\/admin\/moderation\/content\/(post|comment)\/([a-f0-9-]{36})$/);
 if(target&&req.method==='POST'){
  const [,kind,id]=target,b=await modBody(req),reason=moderationReason(b.reason),table=moderationTable(kind);
  if(!['hide','restore','delete'].includes(b.action))moderationFailure('操作を確認してください。');if(b.action==='delete'&&b.confirm!==true)moderationFailure('完全削除の確認が必要です。');
  return moderationLock(env,async()=>{
   const row=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();if(!row)moderationFailure('対象はすでに削除されています。',404);
   if(b.action==='delete'){await removeModeratedContent(env,{kind,id,actor:user,reason});await flushMediaDeletions(env);return modJSON({ok:true})}
   const hidden=b.action==='hide'?1:0;if(row.hidden===hidden)moderationFailure('表示状態が変わっています。再読み込みしてください。',409);
   const postId=kind==='post'?id:row.post_id;
   const stmts=[moderationAudit(db,user,b.action,kind,id,reason),db.prepare(`UPDATE ${table} SET hidden=? WHERE id=?`).bind(hidden,id)];
   if(hidden)stmts.push(cancelContentPush(db,postId));await db.batch(stmts);return modJSON({ok:true});
  });
 }
 const report=p.match(/^\/api\/admin\/moderation\/reports\/([a-f0-9-]{36})$/);
 if(report&&req.method==='POST'){
  const b=await modBody(req),reason=moderationReason(b.reason);
  return moderationLock(env,async()=>{const row=await db.prepare("SELECT id FROM content_reports WHERE id=? AND status='open'").bind(report[1]).first();if(!row)moderationFailure('通報は処理済み、または見つかりません。',409);const now=Date.now();await db.batch([moderationAudit(db,user,'resolve_report','report',row.id,reason,now),db.prepare("UPDATE content_reports SET status='resolved',resolution=?,resolved_by=?,resolved=? WHERE id=?").bind(reason,user.id,now,row.id)]);return modJSON({ok:true})});
 }
 moderationFailure('対応していない操作です。',405);
}
