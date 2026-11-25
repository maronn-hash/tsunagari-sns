let selectedVideo=null;
function clearVideo(){if(selectedVideo)URL.revokeObjectURL(selectedVideo.url);selectedVideo=null;$('#video-preview').replaceChildren();$('#video-input').value=''}
$('#add-video').onclick=()=>{if(!busy&&me)$('#video-input').click()};
$('#video-input').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;
 if(photos.length){toast('動画は写真・スタンプとは別に投稿してください。');return}
 if(file.size>20000000){toast('動画は20MB以内にしてください。');return}
 if(!/\.mp4$/i.test(file.name)&&file.type!=='video/mp4'){toast('MP4形式で書き出した動画を選んでください。');return}
 const owner=me?.id,url=URL.createObjectURL(file),video=document.createElement('video');video.preload='metadata';busy=true;updateComposer();
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('動画を読み込めませんでした。'))},15000);function cleanup(){clearTimeout(timer);video.onloadedmetadata=null;video.onerror=null}video.onloadedmetadata=()=>{cleanup();resolve()};video.onerror=()=>{cleanup();reject(Error('この動画を再生できません。MP4（H.264形式）で書き出してください。'))};video.src=url});
  if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>60)throw Error('動画は60秒以内にしてください。');
  if(me?.id!==owner){URL.revokeObjectURL(url);return}
  clearVideo();selectedVideo={file,url};
  $('#video-preview').innerHTML='<video controls playsinline preload="metadata" aria-label="添付する動画"></video><button type="button" class="secondary" id="remove-video">動画を外す</button>';
  $('#video-preview video').src=url;$('#remove-video').onclick=()=>{if(!busy){clearVideo();updateComposer()}};
 }catch(error){URL.revokeObjectURL(url);if(me?.id===owner)toast(error.message)}finally{video.removeAttribute('src');video.load();busy=false;updateComposer()}
};
