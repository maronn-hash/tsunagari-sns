import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeBackup} from './backup-files.mjs';
const day=86400000;
export function createOperations(env,{directory,backupDirectory=process.env.BACKUP_DIRECTORY||path.resolve(directory)+'-backups',intervalMs=60000,startDelayMs=5000}={}){
 directory=path.resolve(directory);backupDirectory=path.resolve(backupDirectory);
 if(backupDirectory===directory||backupDirectory.startsWith(directory+path.sep)||directory.startsWith(backupDirectory+path.sep))throw Error('Backup directory must be separate from live data');
 let closed=false,running=false,pending=null,ticking=null,requests=0,errors=0,slow=0,auditFailed=false,lastError=null,lastProbe=0;const started=Date.now();
 async function event(code,severity='error'){try{await env.DB.prepare('INSERT INTO system_events(id,code,severity,created) VALUES (?,?,?,?)').bind(randomUUID(),code,severity,Date.now()).run()}catch{auditFailed=true}if(code==='audit_failed')auditFailed=true}
 const ready=env.DB.prepare("UPDATE backup_runs SET status='failed',finished=? WHERE status='running'").bind(Date.now()).run().then(()=>event('server_started','info'));
 async function perform(){
  const id='backup-'+Date.now()+'-'+randomUUID(),temp=path.join(backupDirectory,'.partial-'+id),dest=path.join(backupDirectory,id),now=Date.now();
  try{
   await env.DB.prepare("INSERT INTO backup_runs(id,status,created) VALUES (?,'running',?)").bind(id,now).run();
   fs.mkdirSync(backupDirectory,{recursive:true,mode:0o700});if(fs.lstatSync(backupDirectory).isSymbolicLink())throw Error('Backup root symlink');
   const info=writeBackup(env,directory,temp);fs.renameSync(temp,dest);
   const bytes=info.files.reduce((n,f)=>n+f.bytes,0);
   await env.DB.prepare("UPDATE backup_runs SET status='success',bytes=?,finished=? WHERE id=?").bind(bytes,Date.now(),id).run();lastError=null;await event('backup_succeeded','info');
   // Prune only known successful generations, and only after a verified new backup.
   const setting=await env.DB.prepare('SELECT keep_count FROM backup_settings WHERE id=1').first();const old=await env.DB.prepare("SELECT id FROM backup_runs WHERE status='success' ORDER BY created DESC,id DESC LIMIT -1 OFFSET ?").bind(setting.keep_count).all();
   for(const row of old.results){if(!/^backup-\d+-[a-f0-9-]{36}$/.test(row.id))continue;const target=path.join(backupDirectory,row.id);if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())continue;fs.rmSync(target,{recursive:true,force:true});await env.DB.prepare("UPDATE backup_runs SET status='pruned' WHERE id=?").bind(row.id).run()}
  }catch{lastError='backup_failed';await event('backup_failed');await env.DB.prepare("UPDATE backup_runs SET status='failed',finished=? WHERE id=? AND status='running'").bind(Date.now(),id).run().catch(()=>{});
   // A failed partial copy cannot be used as a restore point.
   if(path.dirname(temp)===backupDirectory&&!fs.existsSync(dest))try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
  }finally{running=false}
 }
 async function backup(){if(closed||running)return {ok:false,error:'バックアップを実行中です。'};running=true;pending=new Promise(resolve=>setImmediate(resolve)).then(()=>perform());return {ok:true}}
 async function tick(){if(closed)return;await ready;const now=Date.now();try{
  await env.DB.prepare('SELECT 1 AS ok').first();lastProbe=now;
  await env.DB.prepare('DELETE FROM operation_audit WHERE created<? OR id IN (SELECT id FROM operation_audit ORDER BY created DESC,id DESC LIMIT -1 OFFSET 100000)').bind(now-365*day).run();
  await env.DB.prepare('DELETE FROM system_events WHERE created<? OR id IN (SELECT id FROM system_events ORDER BY created DESC,id DESC LIMIT -1 OFFSET 10000)').bind(now-30*day).run();
  await env.DB.prepare("DELETE FROM backup_runs WHERE status IN ('failed','pruned') AND created<?").bind(now-365*day).run();
  const s=await env.DB.prepare('SELECT * FROM backup_settings WHERE id=1').first();const latest=await env.DB.prepare('SELECT created,status FROM backup_runs ORDER BY created DESC LIMIT 1').first();
  const success=await env.DB.prepare("SELECT id,created FROM backup_runs WHERE status='success' ORDER BY created DESC LIMIT 1").first();
  if(s.enabled&&!running&&(!success||!fs.existsSync(path.join(backupDirectory,success.id,'manifest.json'))||now-success.created>=day)&&(!latest||now-latest.created>=3600000))await backup();
 }catch{lastError='health_failed';await event('health_failed')}
 }
 function check(){if(ticking)return ticking;ticking=tick().finally(()=>{ticking=null});return ticking}
 async function status(){
  const now=Date.now(),alerts=[];let database=true,freeBytes=null;
  try{await env.DB.prepare('SELECT 1').first()}catch{database=false;alerts.push('database_unavailable')}
  try{const st=fs.statfsSync(directory);freeBytes=Number(st.bavail)*Number(st.bsize);if(freeBytes<1024**3)alerts.push('disk_low')}catch{alerts.push('disk_unknown')}
  let backupFreeBytes=null;try{let disk=backupDirectory;while(!fs.existsSync(disk)&&path.dirname(disk)!==disk)disk=path.dirname(disk);const st=fs.statfsSync(disk);backupFreeBytes=Number(st.bavail)*Number(st.bsize);if(backupFreeBytes<1024**3)alerts.push('backup_disk_low')}catch{alerts.push('backup_disk_unknown')}
  const settings=await env.DB.prepare('SELECT enabled,keep_count FROM backup_settings WHERE id=1').first();
  const runs=await env.DB.prepare('SELECT * FROM backup_runs ORDER BY created DESC LIMIT 30').all();
  const success=await env.DB.prepare("SELECT id,created FROM backup_runs WHERE status='success' ORDER BY created DESC LIMIT 1").first();
  if(settings.enabled&&(!success||now-success.created>26*3600000))alerts.push('backup_overdue');if(success&&!fs.existsSync(path.join(backupDirectory,success.id,'manifest.json')))alerts.push('backup_missing');if(runs.results[0]?.status==='failed'||lastError==='backup_failed')alerts.push('backup_failed');
  const failed=await env.DB.prepare("SELECT count(*) AS n FROM operation_audit WHERE target='auth/login' AND status>=400 AND created>?").bind(now-900000).first();if(failed.n>=10)alerts.push('login_failures');
  const recentErrors=await env.DB.prepare("SELECT count(*) AS n FROM system_events WHERE severity='error' AND created>?").bind(now-900000).first();if(recentErrors.n)alerts.push('recent_errors');if(auditFailed)alerts.push('audit_failed');
  const jobs=await env.DB.prepare('SELECT count(*) AS n,min(created) AS oldest FROM push_jobs').first();if(jobs.n&&jobs.oldest<now-300000)alerts.push('push_delayed');
  const media=await env.DB.prepare('SELECT count(*) AS n FROM media_deletions').first();if(media.n)alerts.push('media_pending');
  return {uptimeSeconds:Math.floor((now-started)/1000),requests,errors,slow,memoryBytes:process.memoryUsage().rss,freeBytes,backupFreeBytes,database,lastProbe,backupDirectory,running,settings,runs:runs.results,alerts,loginFailures:failed.n,pushJobs:jobs.n,mediaPending:media.n};
 }
 const timer=setInterval(()=>void check(),intervalMs);timer.unref();const first=setTimeout(()=>void check(),startDelayMs);first.unref();
 return {backup,status,event,check,async idle(){if(pending)await pending},observe(status,ms){requests++;if(ms>=2000)slow++;if(status>=500){errors++;void event('request_failed')}},async close(){closed=true;clearInterval(timer);clearTimeout(first);if(ticking)await ticking;if(pending)await pending;await ready}};
}
