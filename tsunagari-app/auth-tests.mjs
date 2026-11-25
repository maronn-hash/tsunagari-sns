import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import worker from './dist/server/index.js';import {createEnv} from './local-adapter.mjs';
const setupCode='test-only-bootstrap-key-not-for-production';
function harness(){const env=createEnv();env.ADMIN_SETUP_TOKEN=setupCode;let ip=1;async function req(path,{method='GET',cookie,body,origin='https://sns.test',headers={},address}={}){const h={origin,'cf-connecting-ip':address||'192.0.2.'+ip++,...headers};if(cookie)h.cookie=cookie;if(body!==undefined){h['content-type']='application/json';body=JSON.stringify(body)}return worker.fetch(new Request('https://sns.test'+path,{method,headers:h,body}),env)}return {env,req}}
const cookie=r=>r.headers.get('set-cookie')?.split(';')[0];
async function admin(req){const r=await req('/api/auth/register',{method:'POST',body:{username:'admin',name:'Admin',password:'administrator-password',code:setupCode}});assert.equal(r.status,201);return cookie(r)}
async function member(req,adminCookie,name='member'){const invite=await(await req('/api/admin/invites',{method:'POST',cookie:adminCookie,body:{username:name}})).json();const r=await req('/api/auth/register',{method:'POST',body:{username:name,name,password:'member-password-123',code:invite.code}});assert.equal(r.status,201);return {cookie:cookie(r),invite}}

test('own account login, logout and password change invalidate sessions',async()=>{const {env,req}=harness();const a=await admin(req);const m=await member(req,a);let r=await req('/api/auth/login',{method:'POST',body:{username:'MEMBER',password:'member-password-123'}});assert.equal(r.status,200);const old=cookie(r);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/Secure/);assert.match(r.headers.get('set-cookie'),/SameSite=Lax/);assert.match(r.headers.get('set-cookie'),/^__Host-/);
assert.equal((await req('/api/me',{headers:{'oai-authenticated-user-id':'admin'}})).status,401);
assert.equal((await req('/api/me',{cookie:'__Host-tsunagari='+'0'.repeat(64)})).status,401);
assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'member',password:'wrong-password'}})).status,401);
r=await req('/api/auth/password',{method:'POST',cookie:old,body:{currentPassword:'member-password-123',newPassword:'new-member-password'}});assert.equal(r.status,200);const changed=cookie(r);
assert.equal((await req('/api/me',{cookie:old})).status,401);assert.equal((await req('/api/me',{cookie:m.cookie})).status,401);assert.equal((await req('/api/me',{cookie:changed})).status,200);
assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'member',password:'member-password-123'}})).status,401);
assert.equal((await req('/api/auth/logout',{method:'POST',cookie:changed})).status,200);assert.equal((await req('/api/me',{cookie:changed})).status,401);
const hashes=env.sqlite.prepare('SELECT password_hash FROM accounts').all();assert.ok(hashes.every(r=>r.password_hash.startsWith('scrypt$16384$8$5$')));assert.ok(!JSON.stringify(hashes).includes('new-member-password'));env.sqlite.close()});

test('invites are username-bound, expiring, single-use and admin-only',async()=>{const {env,req}=harness();assert.equal((await req('/api/auth/register',{method:'POST',body:{username:'intruder',name:'X',password:'some-long-password',code:'invalid'}})).status,403);const a=await admin(req),m=await member(req,a);
assert.equal((await req('/api/admin/invites',{method:'POST',cookie:m.cookie,body:{username:'guest'}})).status,403);
assert.equal((await req('/api/admin/members',{cookie:m.cookie})).status,403);
assert.equal((await req('/api/auth/register',{method:'POST',body:{username:'member',name:'Replay',password:'some-long-password',code:m.invite.code}})).status,403);
const invite=await(await req('/api/admin/invites',{method:'POST',cookie:a,body:{username:'future'}})).json();
assert.equal((await req('/api/auth/register',{method:'POST',body:{username:'other',name:'Wrong',password:'some-long-password',code:invite.code}})).status,403);
env.sqlite.exec('UPDATE invitations SET expires=0');assert.equal((await req('/api/auth/register',{method:'POST',body:{username:'future',name:'Expired',password:'some-long-password',code:invite.code}})).status,403);
assert.equal((await req('/api/auth/register',{method:'POST',body:{username:'secondadmin',name:'X',password:'some-long-password',code:setupCode}})).status,403);
const users=await(await req('/api/admin/members',{cookie:a})).json(),id=users.find(u=>u.username==='member').id;
assert.equal((await req('/api/admin/members',{method:'PATCH',cookie:a,body:{id,enabled:false}})).status,200);
assert.equal((await req('/api/me',{cookie:m.cookie})).status,401);
assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'member',password:'member-password-123'}})).status,401);
const self=users.find(u=>u.username==='admin').id;assert.equal((await req('/api/admin/members',{method:'PATCH',cookie:a,body:{id:self,enabled:false}})).status,400);
assert.equal((await req('/api/admin/members',{method:'PATCH',cookie:a,body:{id,enabled:true}})).status,200);
assert.equal((await req('/api/me',{cookie:m.cookie})).status,401);assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'member',password:'member-password-123'}})).status,200);env.sqlite.close()});

test('no setup secret fails closed, CSRF blocked, expiry and rate limits enforced',async()=>{const {env,req}=harness();delete env.ADMIN_SETUP_TOKEN;assert.equal((await req('/api/auth/register',{method:'POST',body:{username:'admin',name:'Admin',password:'administrator-password',code:setupCode}})).status,503);env.ADMIN_SETUP_TOKEN=setupCode;
assert.equal((await req('/api/auth/register',{method:'POST',origin:'https://attacker.test',body:{username:'admin',name:'Admin',password:'administrator-password',code:setupCode}})).status,403);
const a=await admin(req);assert.equal((await req('/api/auth/logout',{method:'POST',cookie:a,origin:'https://attacker.test'})).status,403);assert.equal((await req('/api/me',{cookie:a})).status,200);
env.sqlite.exec('UPDATE sessions SET expires=0');assert.equal((await req('/api/me',{cookie:a})).status,401);
for(let i=0;i<8;i++)assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'unknown',password:'wrong-password'}})).status,401);
assert.equal((await req('/api/auth/login',{method:'POST',body:{username:'unknown',password:'wrong-password'}})).status,429);env.sqlite.close()});

test('concurrent bootstrap and invite claims create at most one account',async()=>{const {env,req}=harness();const attempts=await Promise.all(['adminone','admintwo'].map(username=>req('/api/auth/register',{method:'POST',body:{username,name:username,password:'administrator-password',code:setupCode}})));assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);const a=cookie(attempts.find(r=>r.status===201));const invite=await(await req('/api/admin/invites',{method:'POST',cookie:a,body:{username:'newmember'}})).json();const members=await Promise.all([1,2].map(()=>req('/api/auth/register',{method:'POST',body:{username:'newmember',name:'Member',password:'member-password-123',code:invite.code}})));assert.deepEqual(members.map(r=>r.status).sort(),[201,409]);assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM accounts').get().n,2);assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM profiles').get().n,2);env.sqlite.close()});
