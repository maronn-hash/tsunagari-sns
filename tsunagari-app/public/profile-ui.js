const profileKeyPattern=/^[a-f0-9-]+\/\d+\.(jpg|png|webp)$/;
function profileImageURL(key){return typeof key==='string'&&profileKeyPattern.test(key)?'/media/'+key:''}
function avatarMarkup(name,key){const url=profileImageURL(key);return url?`<img src="${esc(url)}" alt="" loading="lazy">`:avatar(name)}
let profileEditVersion=0,profileViewVersion=0,profileSaving=false,profileProcessing=0;
let profileImages={avatar:{},header:{}};
function clearProfileDraft(){
 profileEditVersion++;
 for(const image of Object.values(profileImages))if(image.url)URL.revokeObjectURL(image.url);
 profileImages={avatar:{},header:{}};profileProcessing=0;
 $('#profile-form').reset();
 $('#profile-header-preview').removeAttribute('src');$('#profile-avatar-preview').replaceChildren();
}
function resetProfileEditor(){clearProfileDraft();profileViewVersion++;$('#profile-view-content').replaceChildren();$('#profile-account-actions').hidden=true;}
function profilePreview(kind){
 const image=profileImages[kind],key=image.remove?'':me?.[kind+'_key'],url=image.url||profileImageURL(key);
 if(kind==='header'){const img=$('#profile-header-preview');img.hidden=!url;if(url)img.src=url;else img.removeAttribute('src')}
 else $('#profile-avatar-preview').innerHTML=url?`<img src="${esc(url)}" alt="アイコンのプレビュー">`:avatar($('#profile-name').value);
 $('#remove-'+kind).hidden=!url;
}
function profileSaveState(){$('#profile-save').disabled=profileSaving||profileProcessing>0;$('#profile-save').textContent=profileSaving?'保存中…':profileProcessing?'画像を処理中…':'保存';$('#profile-fields').disabled=profileSaving;$('#profile-close').disabled=profileSaving}
function showProfile(){
 if(!me)return;
 resetProfileEditor();$('#profile-view-dialog').close();
 for(const key of ['name','bio','location'])$('#profile-'+key).value=me[key]||'';
 $('#profile-bio-count').textContent=$('#profile-bio').value.length;
 $('#profile-edit-error').hidden=true;profilePreview('avatar');profilePreview('header');profileSaveState();$('#profile-dialog').showModal();
}
async function cropProfileImage(file,kind){
 if(!file||file.size>25000000)throw Error('元の画像は25MB以内にしてください。');
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;await img.decode();
  const w=kind==='avatar'?400:1500,h=kind==='avatar'?400:500,ratio=w/h;
  let sw=img.naturalWidth,sh=img.naturalHeight;
  if(sw/sh>ratio)sw=sh*ratio;else sh=sw/ratio;
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,0,0,w,h);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
  if(!blob||blob.size>3000000)throw Error('画像を小さくして、もう一度お試しください。');
  return new File([blob],kind+'.jpg',{type:'image/jpeg'});
 }catch(e){throw Error(e.message?.includes('画像')?e.message:'画像を読み込めませんでした。JPEG・PNG・WebPをお試しください。')}
 finally{URL.revokeObjectURL(url)}
}
for(const kind of ['avatar','header']){
 $('#choose-'+kind).onclick=()=>$('#profile-'+kind+'-input').click();
 $('#profile-'+kind+'-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  const version=profileEditVersion,sequence=(profileImages[kind].sequence||0)+1;profileImages[kind].sequence=sequence;
  profileProcessing++;profileSaveState();
  try{
   const result=await cropProfileImage(file,kind);
   if(version!==profileEditVersion||sequence!==profileImages[kind].sequence)return;
   if(profileImages[kind].url)URL.revokeObjectURL(profileImages[kind].url);
   profileImages[kind]={file:result,url:URL.createObjectURL(result),remove:false,sequence};profilePreview(kind);
  }catch(e){if(version===profileEditVersion)toast(e.message)}
  finally{if(version===profileEditVersion){profileProcessing--;profileSaveState()}}
 };
 $('#remove-'+kind).onclick=()=>{const image=profileImages[kind];if(image.url)URL.revokeObjectURL(image.url);profileImages[kind]={remove:true,sequence:(image.sequence||0)+1};profilePreview(kind)};
}
$('#profile-name').oninput=()=>profilePreview('avatar');
$('#profile-bio').oninput=()=>$('#profile-bio-count').textContent=$('#profile-bio').value.length;
$('#profile-dialog').addEventListener('cancel',e=>{if(profileSaving)e.preventDefault()});
$('#profile-dialog').addEventListener('close',()=>{if(!profileSaving)clearProfileDraft()});
$('#profile-form').onsubmit=async e=>{
 e.preventDefault();if(profileSaving||profileProcessing)return;
 profileSaving=true;profileSaveState();$('#profile-edit-error').hidden=true;
 try{
  const form=new FormData();for(const key of ['name','bio','location'])form.set(key,$('#profile-'+key).value);
  for(const kind of ['avatar','header']){const image=profileImages[kind];if(image.file)form.set(kind,image.file);else if(image.remove)form.set('remove_'+kind,'1')}
  await api('/api/me',{method:'PATCH',body:form});me=await api('/api/me');updateMe();
  profileSaving=false;$('#profile-dialog').close();clearProfileDraft();toast('プロフィールを保存しました。');load();openProfileView(me.id);
 }catch(e){$('#profile-edit-error').textContent=e.message;$('#profile-edit-error').hidden=false}
 finally{profileSaving=false;profileSaveState()}
};
async function openProfileView(id){
 if(!me)return;const version=++profileViewVersion;
 $('#comments-dialog').close();$('#profile-account-actions').hidden=true;$('#profile-view-content').textContent='プロフィールを読み込んでいます…';
 if(!$('#profile-view-dialog').open)$('#profile-view-dialog').showModal();
 try{
  const p=await api('/api/profiles/'+encodeURIComponent(id));if(version!==profileViewVersion||!me)return;
  const header=profileImageURL(p.header_key),own=p.id===me.id;
  $('#profile-view-content').innerHTML=`<div class="profile-cover">${header?`<img src="${esc(header)}" alt="${esc(p.name)}のヘッダー画像">`:''}</div><div class="profile-detail"><div class="profile-identity-row"><span class="avatar profile-large-avatar">${avatarMarkup(p.name,p.avatar_key)}</span>${own?'<button class="secondary" id="edit-profile">プロフィールを編集</button>':''}</div><h3>${esc(p.name)}</h3><div class="profile-handle">@${esc(p.username)}</div>${p.bio?`<p class="profile-bio">${esc(p.bio)}</p>`:'<p class="profile-bio profile-muted">自己紹介はまだありません。</p>'}<div class="profile-details-meta">${p.location?`<span>${icon('home')}${esc(p.location)}</span>`:''}</div><div class="profile-post-count"><strong>${p.post_count}</strong> 投稿</div></div>`;
  $('#profile-account-actions').hidden=!own;$('#edit-profile')?.addEventListener('click',showProfile);
 }catch(e){if(version===profileViewVersion)$('#profile-view-content').textContent=e.message}
}
['#profile-top','#profile-side','#mobile-profile'].forEach(s=>$(s).onclick=()=>openProfileView(me?.id));
$('#comment-list').addEventListener('click',e=>{const target=e.target.closest('[data-profile]');if(target)openProfileView(target.dataset.profile)});
