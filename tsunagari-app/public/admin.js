const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me=null,mode='all',currentComment=null,adminGeneration=0,adminCheck=0,adminToastTimer;
function load(){} // Shared moderation refreshes the SNS feed only on the SNS page.
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(adminToastTimer);adminToastTimer=setTimeout(()=>{$('#toast').hidden=true},4000)}
function lockAdmin(message=''){
 adminGeneration++;me=null;$('#admin-shell').hidden=true;$('#admin-login').hidden=false;$('#admin-who').textContent='';$('#admin-password').value='';$('#admin-members').textContent='';$('#invite-result').hidden=true;$('#invite-code').value='';$('#admin-status').textContent='';$('#admin-login-error').textContent=message;
 $$('dialog[open]').forEach(d=>d.close());
 if(typeof resetModeration==='function')resetModeration();if(typeof resetOperations==='function')resetOperations();if(typeof resetAnnouncement==='function')resetAnnouncement();if(typeof resetCalendar==='function')resetCalendar();
}
async function api(url,options={}){
 const version=adminGeneration,r=await fetch(url,options);let data;try{data=await r.json()}catch{throw Error('接続できませんでした。ページを更新してください。')}
 if(version!==adminGeneration)throw Error('ログイン状態が変わりました。');
 if(!r.ok){if(r.status===401||r.status===403)lockAdmin(r.status===403?'管理者だけが利用できます。':'管理者アカウントでログインしてください。');throw Object.assign(Error(data.error||'処理できませんでした。'),{status:r.status})}return data;
}
async function authenticateAdmin(openRoute=false){
 const check=++adminCheck;
 try{const user=await api('/api/me');if(check!==adminCheck)return false;if(user.role!=='admin'){lockAdmin('管理者だけが利用できます。管理者アカウントでログインしてください。');return false}
 const changed=!me||me.id!==user.id;if(changed)lockAdmin();me=user;$('#admin-login').hidden=true;$('#admin-shell').hidden=false;$('#admin-login-error').textContent='';$('#admin-who').textContent=user.name;$('#admin-password').value='';
 if(changed){initCalendar();loadAnnouncement()}if(openRoute)await routeAdmin();return true;
 }catch(e){if(check===adminCheck)lockAdmin(e.status===401?'管理者アカウントでログインしてください。':e.message);return false}
}
async function members(){if(me?.role!=='admin')return;const owner=me.id,version=adminGeneration,data=await api('/api/admin/members');if(me?.id!==owner||version!==adminGeneration)return;$('#admin-members').innerHTML=data.map(u=>`<div class="member-row"><span><strong>${esc(u.name)}</strong><small>${esc(u.username)} · ${u.role==='admin'?'管理者':'メンバー'}${u.enabled?'':' · 停止中'}</small></span>${u.id===me.id?'<small>自分</small>':`<button data-member="${esc(u.id)}" data-enabled="${u.enabled?'false':'true'}">${u.enabled?'利用を停止':'利用を再開'}</button>`}</div>`).join('')}
$('#open-admin').onclick=async()=>{if(me?.role!=='admin')return;$('#invite-result').hidden=true;$('#invite-code').value='';$('#admin-members').textContent='読み込んでいます…';$('#admin-dialog').showModal();try{await members()}catch(e){if(me)toast(e.message)}};
$('#invite-form').onsubmit=async e=>{e.preventDefault();if(me?.role!=='admin')return;const owner=me.id,version=adminGeneration,b=e.submitter;b.disabled=true;try{const d=await api('/api/admin/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#invite-username').value})});if(owner!==me?.id||version!==adminGeneration)return;$('#invite-target').textContent='ログインID：'+d.username;$('#invite-code').value=d.code;$('#invite-expiry').textContent='有効期限：'+new Date(d.expires).toLocaleString('ja-JP');$('#invite-result').hidden=false}catch(e){if(me)toast(e.message)}finally{b.disabled=false}};
$('#copy-invite').onclick=async()=>{if(me?.role!=='admin')return;try{await navigator.clipboard.writeText($('#invite-code').value);toast('招待コードをコピーしました。')}catch{$('#invite-code').focus();$('#invite-code').select();toast('選択したコードをコピーしてください。')}};
$('#admin-members').onclick=async e=>{if(me?.role!=='admin')return;const b=e.target.closest('[data-member]');if(!b)return;const owner=me.id,version=adminGeneration,enabled=b.dataset.enabled==='true';if(!enabled&&!confirm('このメンバーの利用を停止しますか？すべての端末からログアウトされます。'))return;b.disabled=true;try{await api('/api/admin/members',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.member,enabled})});if(owner!==me?.id||version!==adminGeneration)return;await members();toast(enabled?'利用を再開しました。':'利用を停止しました。')}catch(e){if(me)toast(e.message);b.disabled=false}};
$('#admin-login-form').onsubmit=async e=>{e.preventDefault();const b=$('#admin-login-submit');b.disabled=true;$('#admin-login-error').textContent='';try{await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#admin-username').value,password:$('#admin-password').value})});adminChannel?.postMessage('changed');await authenticateAdmin(true)}catch(e){$('#admin-login-error').textContent=e.message}finally{b.disabled=false;$('#admin-password').value=''}};
$('#admin-logout').onclick=async()=>{const b=$('#admin-logout');b.disabled=true;try{await api('/api/auth/logout',{method:'POST'});lockAdmin('ログアウトしました。');adminChannel?.postMessage('changed')}catch(e){toast(e.message)}finally{b.disabled=false}};
$('#refresh').onclick=async()=>{if(await authenticateAdmin()){loadAnnouncement();loadCalendar();toast('情報を更新しました。')}};
$('#admin-open-audit').onclick=()=>{if(me?.role!=='admin')return;$('#open-operations').onclick();opsTab='audit';opsOffset=0;loadOperations()};
$('#admin-open-announcement').onclick=async()=>{if(me?.role!=='admin')return;await loadAnnouncement();if(me?.role==='admin')$('#announcement-edit').onclick()};
async function routeAdmin(){if(me?.role!=='admin')return;const [section,query='']=location.hash.slice(1).split('?');
 if(!['members','moderation','operations','audit','announcement','calendar'].includes(section))return;
 $$('dialog[open]').forEach(d=>d.close());
 if(section==='members')await $('#open-admin').onclick();
 if(section==='moderation'){const params=new URLSearchParams(query),kind=params.get('kind'),id=params.get('id');await openModeration(['post','comment'].includes(kind)&&/^[a-f0-9-]{36}$/.test(id||'')?{kind,id}:null)}
 if(section==='operations')$('#open-operations').onclick();if(section==='audit')$('#admin-open-audit').onclick();if(section==='announcement')await $('#admin-open-announcement').onclick();if(section==='calendar')openCalendar();
}
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
window.addEventListener('hashchange',()=>routeAdmin());window.addEventListener('focus',()=>authenticateAdmin());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')authenticateAdmin()});
const adminChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('tsunagari-session'):null;
if(adminChannel)adminChannel.onmessage=()=>{lockAdmin();authenticateAdmin(true)};
