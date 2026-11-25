import {scrypt,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';

// Each invite and session stores only a SHA-256 hash. Passwords use salted scrypt.
// N=2^14, r=8, p=5: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
const SESSION_AGE=7*24*3600,COOKIE='__Host-tsunagari';
const digest=v=>createHash('sha256').update(v).digest('hex');
const randomToken=()=>randomBytes(32).toString('hex');
const error=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const response=(data,status=200,cookie)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
function cookieName(env){return env.LOCAL_DEV===true?'tsunagari_local':COOKIE}
function cookieValue(token,env,maxAge=SESSION_AGE){return `${cookieName(env)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.LOCAL_DEV===true?'':'; Secure'}`}
function tokenFrom(req,env){const value=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(env)+'='))?.split('=')[1];return value&&/^[a-f0-9]{64}$/.test(value)?value:null}
function username(value){if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(value))error('ログインIDは半角英数字・_・-・. の3〜40文字で入力してください。');return value.toLowerCase()}
function password(value){if(typeof value!=='string'||value.length<12||value.length>128)error('パスワードは12〜128文字で設定してください。');return value}
function derive(value,salt){return new Promise((resolve,reject)=>scrypt(value,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024},(e,key)=>e?reject(e):resolve(key)))}
async function hashPassword(value){const salt=randomBytes(16).toString('hex');return `scrypt$16384$8$5$${salt}$${(await derive(value,salt)).toString('hex')}`}
async function checkPassword(value,stored){const parts=(stored||'').split('$');const salt=parts[4]||'00000000000000000000000000000000';const actual=await derive(value,salt);const expected=Buffer.from(parts[5]||'00'.repeat(32),'hex');return parts.slice(0,4).join('$')==='scrypt$16384$8$5'&&expected.length===actual.length&&timingSafeEqual(actual,expected)}
async function readJSON(req){if(!req.headers.get('content-type')?.startsWith('application/json'))error('JSON形式で送信してください。',415);const reader=req.body?.getReader();let size=0,chunks=[];if(reader){while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();error('入力内容が大きすぎます。',413)}chunks.push(value)}}try{return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))}catch{error('入力内容を確認してください。')}}
async function limit(req,env,scope,key,max){const now=Date.now(),bucket=await env.DB.prepare('INSERT INTO auth_attempts (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.expires<=? THEN 1 ELSE auth_attempts.count+1 END,expires=CASE WHEN auth_attempts.expires<=? THEN excluded.expires ELSE auth_attempts.expires END RETURNING count').bind(digest(scope+':'+key),now+900000,now,now).first();if(bucket.count>max)error('試行回数が多いため、15分ほど待ってからお試しください。',429)}
async function issueSession(env,userId){const token=randomToken();await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),env.DB.prepare('DELETE FROM auth_attempts WHERE expires<=?').bind(Date.now()),env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires) VALUES (?,?,?)').bind(digest(token),userId,Date.now()+SESSION_AGE*1000)]);return cookieValue(token,env)}
export async function pushSession(req,env){return digest(tokenFrom(req,env)||'')}
export async function identity(req,env){const token=tokenFrom(req,env);if(!token)error('社内アカウントでログインしてください。',401);const user=await env.DB.prepare('SELECT a.user_id AS id,a.username,a.role,p.name FROM sessions s JOIN accounts a ON a.user_id=s.user_id JOIN profiles p ON p.id=a.user_id WHERE s.token_hash=? AND s.expires>? AND a.enabled=1').bind(digest(token),Date.now()).first();if(!user)error('ログインの有効期限が切れました。もう一度ログインしてください。',401);return user}
export async function handleAuth(req,env){const path=new URL(req.url).pathname,db=env.DB;
 if(!path.startsWith('/api/auth/')&&!path.startsWith('/api/admin/'))return null;
 if(path==='/api/auth/status'&&req.method==='GET'){const row=await db.prepare('SELECT count(*) AS count FROM accounts').first();return response({setupRequired:row.count===0,setupConfigured:typeof env.ADMIN_SETUP_TOKEN==='string'&&env.ADMIN_SETUP_TOKEN.length>=32})}
 const ip=req.headers.get('cf-connecting-ip')||'unknown';
 if(path==='/api/auth/login'&&req.method==='POST'){
  await limit(req,env,'login-ip',ip,40);const b=await readJSON(req),name=username(b.username);await limit(req,env,'login-name',name,8);
  if(typeof b.password!=='string'||b.password.length>128)error('ログインIDまたはパスワードが違います。',401);
  const a=await db.prepare('SELECT * FROM accounts WHERE username=?').bind(name).first();const valid=await checkPassword(b.password,a?.password_hash);
  if(!valid||!a?.enabled)error('ログインIDまたはパスワードが違います。',401);
  return response({ok:true},200,await issueSession(env,a.user_id));
 }
 if(path==='/api/auth/register'&&req.method==='POST'){
  await limit(req,env,'register-ip',ip,10);const b=await readJSON(req),name=username(b.username),pass=password(b.password),display=typeof b.name==='string'?b.name.trim():'';
  if(!display||display.length>40)error('表示名を1〜40文字で入力してください。');
  if(typeof b.code!=='string'||b.code.length>256)error('招待コードを確認してください。',403);
  const count=(await db.prepare('SELECT count(*) AS count FROM accounts').first()).count;const bootstrap=count===0;let invite=null;
  if(bootstrap){if(typeof env.ADMIN_SETUP_TOKEN!=='string'||env.ADMIN_SETUP_TOKEN.length<32)error('管理者による初期設定が必要です。',503);if(!timingSafeEqual(Buffer.from(digest(b.code)),Buffer.from(digest(env.ADMIN_SETUP_TOKEN))))error('初期設定コードを確認してください。',403)}
  else{invite=await db.prepare('SELECT code_hash FROM invitations WHERE code_hash=? AND username=? AND expires>? AND NOT EXISTS(SELECT 1 FROM accounts WHERE invitation_hash=invitations.code_hash)').bind(digest(b.code),name,Date.now()).first();if(!invite)error('招待コードまたはログインIDが違うか、期限切れです。',403)}
  const encoded=await hashPassword(pass),id=crypto.randomUUID();
  try{await db.batch([db.prepare('INSERT INTO profiles(id,name) VALUES (?,?)').bind(id,display),db.prepare('INSERT INTO accounts(user_id,username,password_hash,role,invitation_hash,bootstrap_claim,created) VALUES (?,?,?,?,CASE WHEN ?=1 THEN NULL ELSE (SELECT code_hash FROM invitations WHERE code_hash=? AND username=? AND expires>?) END,?,?)').bind(id,name,encoded,bootstrap?'admin':'member',bootstrap?1:0,invite?.code_hash||'',name,Date.now(),bootstrap?1:null,Date.now())])}catch(e){if(/UNIQUE|CHECK|constraint/i.test(e.message))error('登録できませんでした。ログインIDや招待コードを確認してください。',409);throw e}
  return response({ok:true},201,await issueSession(env,id));
 }
 if(path==='/api/auth/logout'&&req.method==='POST'){const token=tokenFrom(req,env);if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(digest(token)).run();return response({ok:true},200,cookieValue('',env,0))}
 const user=await identity(req,env);
 if(path==='/api/auth/password'&&req.method==='POST'){
  await limit(req,env,'password-user',user.id,8);const b=await readJSON(req),next=password(b.newPassword);if(typeof b.currentPassword!=='string'||b.currentPassword.length>128)error('現在のパスワードが違います。',403);
  const a=await db.prepare('SELECT password_hash FROM accounts WHERE user_id=?').bind(user.id).first();if(!await checkPassword(b.currentPassword,a.password_hash))error('現在のパスワードが違います。',403);
  await db.batch([db.prepare('UPDATE accounts SET password_hash=? WHERE user_id=?').bind(await hashPassword(next),user.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id)]);return response({ok:true},200,await issueSession(env,user.id));
 }
 if(path.startsWith('/api/admin/')){
  if(user.role!=='admin')error('管理者のみ操作できます。',403);
  if(path==='/api/admin/invites'&&req.method==='POST'){const b=await readJSON(req),name=username(b.username);if(await db.prepare('SELECT user_id FROM accounts WHERE username=?').bind(name).first())error('このログインIDは登録済みです。');const code=randomToken(),expires=Date.now()+7*86400000;await db.prepare('INSERT INTO invitations (code_hash,username,created_by,expires,created) VALUES (?,?,?,?,?)').bind(digest(code),name,user.id,expires,Date.now()).run();return response({code,username:name,expires},201)}
  if(path==='/api/admin/members'&&req.method==='GET'){const result=await db.prepare('SELECT a.user_id AS id,a.username,a.role,a.enabled,p.name FROM accounts a JOIN profiles p ON p.id=a.user_id ORDER BY a.created').all();return response(result.results)}
  if(path==='/api/admin/members'&&req.method==='PATCH'){const b=await readJSON(req);if(typeof b.id!=='string'||typeof b.enabled!=='boolean')error('入力を確認してください。');if(b.id===user.id)error('自分のアカウントは停止できません。');if(!await db.prepare('SELECT user_id FROM accounts WHERE user_id=?').bind(b.id).first())error('メンバーが見つかりません。',404);await db.batch([db.prepare('UPDATE accounts SET enabled=? WHERE user_id=?').bind(b.enabled?1:0,b.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(b.id)]);return response({ok:true})}
 }
 return response({error:'対応していない操作です。'},405);
}
