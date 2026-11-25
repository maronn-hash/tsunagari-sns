let announcementBody='',announcementLoaded=false,announcementRequest=0,announcementSaving=false;
function renderAnnouncement(){
 const admin=me?.role==='admin';
 $('#welcome').hidden=!me||mode==='mine'||mode==='liked'||(!announcementBody&&!admin);
 $('#announcement-body').textContent=announcementBody||(announcementLoaded?'まだ固定コメントはありません。':'固定コメントを読み込んでいます…');
 $('#announcement-edit').hidden=!admin;$('#announcement-edit').disabled=!announcementLoaded;
 $('#announcement-edit').textContent=announcementBody?'編集する':'固定コメントを追加';
}
function resetAnnouncement(){announcementRequest++;announcementBody='';announcementLoaded=false;$('#welcome').hidden=true;$('#announcement-body').textContent='';$('#announcement-text').value='';$('#announcement-error').textContent='';$('#announcement-status').textContent=''}
async function loadAnnouncement(){
 const version=++announcementRequest,owner=me?.id;if(!owner)return;
 $('#announcement-status').textContent='';renderAnnouncement();
 try{const data=await api('/api/announcement');if(version!==announcementRequest||me?.id!==owner)return;announcementBody=data.body;announcementLoaded=true;renderAnnouncement()}
 catch(e){if(version!==announcementRequest||me?.id!==owner)return;$('#announcement-status').textContent=e.message;$('#announcement-body').textContent=announcementBody||'固定コメントを取得できませんでした。ホームの更新ボタンで再試行できます。'}
}
$('#announcement-edit').onclick=()=>{
 if(me?.role!=='admin'||!announcementLoaded||announcementSaving)return;
 $('#announcement-text').value=announcementBody;$('#announcement-error').textContent='';$('#announcement-dialog').showModal();$('#announcement-text').focus();
};
$('#announcement-form').onsubmit=async e=>{
 e.preventDefault();if(me?.role!=='admin'||announcementSaving)return;
 const owner=me.id,body=$('#announcement-text').value;
 announcementSaving=true;$('#announcement-save').disabled=true;$('#announcement-text').disabled=true;$('#announcement-error').textContent='';
 try{
  const data=await api('/api/announcement',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({body})});
  if(me?.id!==owner)return;announcementRequest++;announcementBody=data.body;announcementLoaded=true;renderAnnouncement();$('#announcement-dialog').close();toast(data.body?'固定コメントを保存しました。':'固定コメントを解除しました。');
 }catch(e){if(me?.id===owner)$('#announcement-error').textContent=e.message}
 finally{announcementSaving=false;$('#announcement-save').disabled=false;$('#announcement-text').disabled=false}
};
$('#refresh').addEventListener('click',()=>{if(me)loadAnnouncement()});
window.addEventListener('online',()=>{if(me)loadAnnouncement()});
