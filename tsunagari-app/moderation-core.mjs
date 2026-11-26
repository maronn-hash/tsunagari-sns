// Shared by API actions and the Node maintenance loop. The queue lives on env so
// the bundled Worker and the Node module serialize against the same database.
export async function moderationLock(env,fn){
 const previous=env.MODERATION_LOCK||Promise.resolve();let release;
 env.MODERATION_LOCK=new Promise(resolve=>{release=resolve});await previous.catch(()=>{});
 try{return await fn()}finally{release()}
}
export function moderationFailure(message,status=400){throw Object.assign(Error(message),{status})}
export function moderationReason(value){if(typeof value!=='string'||!value.trim()||value.trim().length>500)moderationFailure('理由を1〜500文字で入力してください。');return value.trim()}
export function moderationTable(kind){if(kind==='post')return 'posts';if(kind==='comment')return 'comments';moderationFailure('対象が正しくありません。')}
export function moderationAudit(db,actor,action,kind,id,reason,now=Date.now()){
 return db.prepare('INSERT INTO moderation_audit(id,actor_id,actor_name,action,target_type,target_id,reason,created) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor?.id||null,actor?.name||'自動処理',action,kind,id,reason,now);
}
export function cancelContentPush(db,postId){
 // Also cancels legacy queued reply messages that have no comment identifier.
 return db.prepare("DELETE FROM push_jobs WHERE json_valid(payload) AND json_extract(payload,'$.url')=?").bind('/?post='+postId);
}
export async function flushMediaDeletions(env){
 const rows=await env.DB.prepare('SELECT key FROM media_deletions ORDER BY created LIMIT 200').all();let removed=0;
 for(const {key} of rows.results){
  if(!/^[a-f0-9-]+\/\d+\.(jpg|png|webp|mp4)$/.test(key))continue;
  try{await env.BUCKET.delete(key);await env.DB.prepare('DELETE FROM media_deletions WHERE key=?').bind(key).run();removed++}catch{/* Keep queued for the next maintenance pass. */}
 }
 return removed;
}
// Call while holding moderationLock. Audit and relational deletes commit together.
export async function removeModeratedContent(env,{kind,id,actor,reason,action='delete',now=Date.now()}){
 const db=env.DB,table=moderationTable(kind),row=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
 if(!row)return false;const postId=kind==='post'?id:row.post_id;
 const statements=[moderationAudit(db,actor,action,kind,id,reason,now),cancelContentPush(db,postId)];
 if(kind==='post'){
  for(const key of JSON.parse(row.images))statements.push(db.prepare('INSERT OR IGNORE INTO media_deletions(key,created) VALUES (?,?)').bind(key,now));
  statements.push(db.prepare("UPDATE content_reports SET status='resolved',resolution=?,resolved_by=?,resolved=? WHERE post_id=? AND status='open'").bind(reason,actor?.id||null,now,id),db.prepare('DELETE FROM comments WHERE post_id=?').bind(id),db.prepare('DELETE FROM likes WHERE post_id=?').bind(id));
 }else statements.push(db.prepare("UPDATE content_reports SET status='resolved',resolution=?,resolved_by=?,resolved=? WHERE target_type='comment' AND target_id=? AND status='open'").bind(reason,actor?.id||null,now,id));
 statements.push(db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id));await db.batch(statements);return true;
}
export async function runContentMaintenance(env,now=Date.now()){
 return moderationLock(env,async()=>{
  const setting=await env.DB.prepare('SELECT retention_days FROM moderation_settings WHERE id=1').first();let posts=0,comments=0;
  if(setting.retention_days){
   const cutoff=now-setting.retention_days*86400000,reason=`保存期間${setting.retention_days}日を経過したため自動削除`;
   for(const [kind,table] of [['post','posts'],['comment','comments']]){
    const rows=await env.DB.prepare(`SELECT id FROM ${table} WHERE created<? ORDER BY created,id LIMIT 50`).bind(cutoff).all();
    for(const row of rows.results)if(await removeModeratedContent(env,{kind,id:row.id,reason,action:'retention_delete',now})){if(kind==='post')posts++;else comments++}
   }
  }
  const media=await flushMediaDeletions(env);return {posts,comments,media};
 });
}
