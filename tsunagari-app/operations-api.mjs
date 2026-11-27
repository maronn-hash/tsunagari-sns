const opsJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function operationRoute(path){
 const match=path.match(/^\/api\/(auth\/(?:login|logout|register|password)|admin\/(?:invites|members)|me|posts(?:\/[a-f0-9-]+(?:\/(?:like|comments)(?:\/[a-f0-9-]+)?)?)?|events(?:\/[a-f0-9-]+)?|announcement|reports|admin\/moderation(?:\/(?:content(?:\/(?:post|comment)\/[a-f0-9-]{36})?|reports(?:\/[a-f0-9-]{36})?|retention|audit))?|admin\/operations(?:\/(?:backup|settings|status|audit|events))?)$/);
 return match?match[1].replace(/\/[a-f0-9-]{36}/g,'/:id'):null;
}
export async function observeOperation(req,env,actor,result,elapsed){
 env.OPS?.observe(result.status,elapsed);
 const route=operationRoute(new URL(req.url).pathname);
 if(!route||['GET','HEAD'].includes(req.method))return;
 try{await env.DB.prepare('INSERT INTO operation_audit(id,actor_id,actor_name,action,target,status,created) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),actor?.id||null,actor?.name||'未認証',req.method,route,result.status,Date.now()).run()}
 catch{env.OPS?.event('audit_failed','error')}
}
export async function handleOperations(req,env,user){
 const u=new URL(req.url),base='/api/admin/operations';if(u.pathname!==base&&!u.pathname.startsWith(base+'/'))return null;
 if(user.role!=='admin')return opsJSON({error:'管理者だけが利用できます。'},403);
 const offset=Math.max(0,Math.min(100000,parseInt(u.searchParams.get('offset')||'0',10)||0));
 if(req.method==='GET'&&u.pathname===base+'/audit'){
  const failed=u.searchParams.get('failed')==='1',r=await env.DB.prepare(`SELECT * FROM operation_audit ${failed?'WHERE status>=400':''} ORDER BY created DESC,id DESC LIMIT 26 OFFSET ?`).bind(offset).all();return opsJSON({items:r.results.slice(0,25),more:r.results.length>25});
 }
 if(req.method==='GET'&&u.pathname===base+'/events'){const r=await env.DB.prepare('SELECT * FROM system_events ORDER BY created DESC,id DESC LIMIT 26 OFFSET ?').bind(offset).all();return opsJSON({items:r.results.slice(0,25),more:r.results.length>25})}
 if(!env.OPS)return opsJSON({error:'稼働監視・バックアップはNode.js版で利用できます。'},503);
 if(req.method==='GET'&&u.pathname===base+'/status')return opsJSON(await env.OPS.status());
 if(req.method==='POST'&&u.pathname===base+'/backup'){const accepted=await env.OPS.backup(user);return opsJSON(accepted,accepted.ok?202:409)}
 if(req.method==='PUT'&&u.pathname===base+'/settings'){
  let b;try{b=await req.json()}catch{return opsJSON({error:'入力内容を確認してください。'},400)}
  if(!b||typeof b.enabled!=='boolean'||![7,14,30].includes(b.keep_count))return opsJSON({error:'自動保存と保存世代を選択してください。'},400);
  await env.DB.prepare('UPDATE backup_settings SET enabled=?,keep_count=? WHERE id=1').bind(b.enabled?1:0,b.keep_count).run();return opsJSON({ok:true});
 }
 return opsJSON({error:'対応していない操作です。'},405);
}
