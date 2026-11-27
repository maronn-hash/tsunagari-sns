let modTab='reports',modOffset=0,modMore=false,modFocus=null,modVersion=0,modAction=null,reportTarget=null,modBusy=false;
function moderationLinks(kind,id){if(!me)return '';return `<div class="${kind==='post'?'post':'comment'}-moderation-links"><button type="button" data-report-kind="${kind}" data-report-id="${esc(id)}">通報</button>${me.role==='admin'?`<button type="button" data-manage-kind="${kind}" data-manage-id="${esc(id)}">管理</button>`:''}</div>`}
const modLabels={hide:'非表示にする',restore:'再表示する',delete:'完全に削除する',resolve_report:'対応済みにする',retention_setting:'保存期間を変更する',author_delete:'投稿者が削除',retention_delete:'保存期間による自動削除'};
function resetModeration(){modVersion++;modAction=null;reportTarget=null;modFocus=null;$('#moderation-list').textContent='';$('#mod-action-reason').value='';$('#report-detail').value=''}
function modMedia(keys){return (keys||[]).filter(key=>/^[a-f0-9-]+\/\d+\.(jpg|png|webp|mp4)$/.test(key)).map(key=>key.endsWith('.mp4')?`<video controls playsinline preload="none" src="/media/${esc(key)}"></video>`:`<img src="/media/${esc(key)}" alt="管理対象の添付画像" loading="lazy">`).join('')}
function modContentButtons(kind,id,hidden){return `<div class="mod-item-actions"><button class="secondary" data-mod-kind="${kind}" data-mod-id="${esc(id)}" data-mod-action="${hidden?'restore':'hide'}">${hidden?'再表示':'非表示'}</button><button class="danger" data-mod-kind="${kind}" data-mod-id="${esc(id)}" data-mod-action="delete">完全削除</button></div>`}
async function openModeration(focus=null){if(me?.role!=='admin')return;$('#profile-view-dialog')?.close();modFocus=focus;modTab=focus?focus.kind:'reports';modOffset=0;$('#mod-search').value='';$('#mod-state').value='all';$('#mod-report-status').value='open';if(!$('#moderation-dialog').open)$('#moderation-dialog').showModal();await loadModeration()}
async function loadModeration(){
 if(me?.role!=='admin')return;const owner=me.id,version=++modVersion;$('#moderation-error').textContent='';$('#moderation-list').textContent='読み込んでいます…';$('#mod-prev').disabled=true;$('#mod-next').disabled=true;
 $$('[data-mod-tab]').forEach(b=>{const selected=b.dataset.modTab===modTab;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected))});
 const content=['post','comment'].includes(modTab);$('#mod-content-filters').hidden=!content;$('#mod-report-filters').hidden=modTab!=='reports';$('#mod-retention').hidden=modTab!=='retention';$('#mod-pagination').hidden=modTab==='retention';$('#mod-focus-note').hidden=!modFocus||!content;
 try{
  if(modTab==='retention'){
   const data=await api('/api/admin/moderation/retention');if(owner!==me?.id||version!==modVersion)return;$('#moderation-list').textContent='';$('#mod-retention-days').value=String(data.retention_days);$('#mod-retention-save').disabled=!data.automatic;$('#mod-retention-help').textContent=data.automatic?'保存期間は投稿・返信の作成日から数えます。投稿を削除すると、その返信・いいね・画像・動画も削除します。初期設定は無期限です。':'この起動方法では自動削除を利用できません。Node.js版のサーバーで起動してください。';renderRetentionPreview(data);return;
  }
  const params=new URLSearchParams({offset:modOffset});let endpoint=modTab;
  if(content){endpoint='content';params.set('kind',modTab);params.set('state',$('#mod-state').value);params.set('q',$('#mod-search').value.trim());if(modFocus)params.set('id',modFocus.id)}
  if(modTab==='reports')params.set('status',$('#mod-report-status').value);
  const data=await api('/api/admin/moderation/'+endpoint+'?'+params);if(owner!==me?.id||version!==modVersion)return;modMore=data.more;
  $('#moderation-list').innerHTML=data.items.length?data.items.map(item=>{
   if(modTab==='audit')return `<article class="mod-item"><strong>${esc(modLabels[item.action]||item.action)}</strong><p>${esc(item.actor_name)} · ${esc(new Date(item.created).toLocaleString('ja-JP'))}</p><p class="mod-reason">${esc(item.reason)}</p><small>対象: ${esc(item.target_type)} / ${esc(item.target_id)}</small></article>`;
   if(modTab==='reports')return `<article class="mod-item"><strong>${esc(item.category)}</strong><p>通報者: ${esc(item.reporter_name)} · ${esc(new Date(item.created).toLocaleString('ja-JP'))}</p><p class="mod-reason">${esc(item.detail||'補足なし')}</p><hr><p>投稿者: ${esc(item.author_name)}${item.hidden?' · 非表示':''}${item.parent_hidden?' · 元の投稿は非表示':''}</p><p class="mod-reason">${esc(item.body===null?'対象は削除済みです':item.body)}</p><div class="mod-media">${modMedia(item.images)}</div><div class="mod-item-actions">${item.body!==null?`<button class="secondary" data-mod-view="${esc(item.target_id)}" data-mod-kind="${esc(item.target_type)}">対象を管理</button>`:''}${item.status==='open'?`<button class="secondary" data-mod-action="resolve_report" data-mod-id="${esc(item.id)}">対応済みにする</button>`:`<p class="mod-reason">対応理由: ${esc(item.resolution)}</p>`}</div></article>`;
   return `<article class="mod-item"><strong>${esc(item.name)}</strong><span class="mod-state">${item.hidden?'非表示':'表示中'}${item.parent_hidden?'（元の投稿は非表示）':''}</span><p>${esc(new Date(item.created).toLocaleString('ja-JP'))}</p><p class="mod-reason">${esc(item.body||'添付のみの投稿')}</p><div class="mod-media">${modMedia(item.images)}</div>${modContentButtons(item.kind,item.id,item.hidden)}</article>`;
  }).join(''):'<p class="mod-empty">該当する項目はありません。</p>';
  $('#mod-page').textContent=`${Math.floor(modOffset/25)+1}ページ`;$('#mod-prev').disabled=modOffset===0;$('#mod-next').disabled=!modMore;
 }catch(e){if(owner===me?.id&&version===modVersion){$('#moderation-list').textContent='';$('#moderation-error').textContent=e.message}}
}
function renderRetentionPreview(data){$('#mod-retention-preview').textContent=`現在この期間を適用した場合の削除対象: 投稿 ${data.posts}件、返信 ${data.comments}件。添付ファイルの削除待ち: ${data.pending_media}件。対象件数は時間の経過や投稿の増減で変わります。`}
function showModAction(action){if(me?.role!=='admin'||modBusy)return;modAction=action;$('#mod-action-title').textContent=modLabels[action.action];$('#mod-action-reason').value='';$('#mod-action-confirm').checked=false;$('#mod-action-error').textContent='';const destructive=action.action==='delete'||(action.action==='retention_setting'&&action.days>0);$('#mod-action-confirm-row').hidden=!destructive;$('#mod-action-confirm').required=destructive;$('#mod-action-help').textContent=action.action==='delete'?'本文と添付を完全に削除します。投稿の場合は返信・いいねも削除します。元に戻せません。操作履歴と通報の記録は残ります。':action.action==='retention_setting'?`保存期間を${action.days?`${action.days}日`:'無期限'}に変更します。${action.days?'既存の投稿も対象です。保存後、サーバー稼働中の自動処理で順次削除されます。元に戻せません。':'以後、保存期間による削除を停止します。すでに削除したデータは戻りません。'}`:action.action==='hide'?'一般メンバーの一覧・検索から隠します。投稿の画像・動画や返信も閲覧できなくなります。管理画面から再表示できます。':action.action==='restore'?'再びメンバーが閲覧できるようにします。元の投稿が非表示の場合、返信はまだ表示されません。':'通報への対応内容を記録します。この操作だけでは投稿を非表示・削除しません。';$('#mod-action-dialog').showModal()}
$('#open-moderation').onclick=()=>openModeration();
$$('[data-mod-tab]').forEach(button=>button.onclick=()=>{modTab=button.dataset.modTab;modOffset=0;modFocus=null;loadModeration()});
$('#mod-filter-form').onsubmit=e=>{e.preventDefault();modOffset=0;modFocus=null;loadModeration()};
$('#mod-report-status').onchange=()=>{modOffset=0;loadModeration()};$('#mod-refresh').onclick=()=>loadModeration();
$('#mod-focus-clear').onclick=()=>{modFocus=null;modOffset=0;loadModeration()};
$('#mod-prev').onclick=()=>{modOffset=Math.max(0,modOffset-25);loadModeration()};$('#mod-next').onclick=()=>{if(modMore){modOffset+=25;loadModeration()}};
$('#moderation-list').onclick=e=>{const view=e.target.closest('[data-mod-view]');if(view){modFocus={kind:view.dataset.modKind,id:view.dataset.modView};modTab=modFocus.kind;modOffset=0;$('#mod-state').value='all';$('#mod-search').value='';loadModeration();return}const button=e.target.closest('[data-mod-action]');if(button)showModAction({action:button.dataset.modAction,kind:button.dataset.modKind,id:button.dataset.modId})};
$('#mod-retention-days').onchange=async()=>{if(me?.role!=='admin')return;const owner=me.id,days=$('#mod-retention-days').value;try{const data=await api('/api/admin/moderation/retention?days='+days);if(me?.id===owner&&$('#mod-retention-days').value===days)renderRetentionPreview(data)}catch(e){if(me?.id===owner)$('#moderation-error').textContent=e.message}};
$('#mod-retention-save').onclick=()=>showModAction({action:'retention_setting',days:Number($('#mod-retention-days').value)});
$('#mod-action-form').onsubmit=async e=>{
 e.preventDefault();if(modBusy||!modAction||me?.role!=='admin')return;const owner=me.id,a={...modAction},button=$('#mod-action-submit');modBusy=true;button.disabled=true;$('#mod-action-error').textContent='';
 try{
  const body={reason:$('#mod-action-reason').value,action:a.action,confirm:$('#mod-action-confirm').checked};let url='/api/admin/moderation/';let method='POST';
  if(a.action==='retention_setting'){url+='retention';method='PUT';body.days=a.days}else if(a.action==='resolve_report')url+='reports/'+a.id;else url+='content/'+a.kind+'/'+a.id;
  await api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(me?.id!==owner)return;
  $('#mod-action-dialog').close();modAction=null;toast('管理操作を保存しました。');await loadModeration();load();
  if(currentComment&&$('#comments-dialog').open)showComments(currentComment,false);
 }catch(error){if(me?.id===owner)$('#mod-action-error').textContent=error.message}finally{modBusy=false;button.disabled=false}
};
document.addEventListener('click',e=>{
 const manage=e.target.closest('[data-manage-kind]');if(manage){openModeration({kind:manage.dataset.manageKind,id:manage.dataset.manageId});return}
 const report=e.target.closest('[data-report-kind]');if(!report||!me)return;reportTarget={kind:report.dataset.reportKind,id:report.dataset.reportId};$('#report-category').value='';$('#report-detail').value='';$('#report-error').textContent='';$('#report-dialog').showModal();
});
$('#report-form').onsubmit=async e=>{
 e.preventDefault();if(!me||!reportTarget||$('#report-submit').disabled)return;const owner=me.id,target={...reportTarget};$('#report-submit').disabled=true;$('#report-error').textContent='';
 try{const data=await api('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...target,category:$('#report-category').value,detail:$('#report-detail').value})});if(me?.id!==owner)return;$('#report-dialog').close();reportTarget=null;toast(data.duplicate?'この内容はすでに通報済みです。':'通報を受け付けました。管理者が確認します。')}
 catch(error){if(me?.id===owner)$('#report-error').textContent=error.message}finally{$('#report-submit').disabled=false}
};
