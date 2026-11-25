let pushConfig=null,pushBusy=false,pushStatusVersion=0;
const pushSupported=()=>isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
const needsHomeApp=()=>(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))&&!window.matchMedia('(display-mode: standalone)').matches&&!navigator.standalone;
function resetPushUI(){pushStatusVersion++;pushConfig=null;$('#notification-status').textContent='';$('#notification-enable').disabled=true;$('#notification-disable').disabled=true;$('#notification-test').disabled=true;$('#notification-repair').disabled=true}
async function pushWorker(){return Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('アプリの準備中です。ページを再読み込みしてください。')),8000))])}
async function openNotifications(){
 if(!me)return;const owner=me.id,version=++pushStatusVersion;$('#profile-view-dialog').close();$('#notifications-dialog').showModal();
 $('#notification-enable').disabled=true;$('#notification-disable').disabled=true;$('#notification-test').disabled=true;$('#notification-repair').disabled=true;
 if(needsHomeApp()){$('#notification-status').textContent='Safariの共有から「ホーム画面に追加」し、そのアイコンから開いてください。iOS 16.4以降が必要です。';return}
 if(!pushSupported()){$('#notification-status').textContent='この環境では通知を利用できません。HTTPSのURLで、通知対応のブラウザーから開いてください。';return}
 $('#notification-status').textContent='通知の設定を確認しています…';
 try{
  const data=await api('/api/push/config');const subscription=await(await pushWorker()).pushManager.getSubscription();
  if(owner!==me?.id||version!==pushStatusVersion)return;pushConfig=data;
  if(!data.available){$('#notification-status').textContent='サーバー側の通知が利用できません。固定URLでの起動と保存先を確認してください。';return}
  const key=Uint8Array.from(atob(data.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const keyMatches=subscription&&(!subscription.options.applicationServerKey||String(new Uint8Array(subscription.options.applicationServerKey))===String(key));
  const active=data.endpoints?.includes(subscription?.endpoint)&&keyMatches&&Notification.permission==='granted';
  const detailed=active&&data.detailEndpoints?.includes(subscription?.endpoint);
  $('#notification-status').textContent=Notification.permission==='denied'?'通知が許可されていません。端末・ブラウザーの設定で許可してください。':active?(detailed?'この端末の通知はオンです。投稿者の名前と本文の冒頭を表示します。':'この端末の通知はオンです。名前と本文も表示するには「通知をオンにする」を押して設定を更新してください。'):'この端末の通知はオフです。';
  $('#notification-enable').disabled=detailed||Notification.permission==='denied';$('#notification-disable').disabled=!subscription;$('#notification-test').disabled=!active;
  $('#notification-repair').disabled=Notification.permission!=='granted';
 }catch(error){if(owner===me?.id&&version===pushStatusVersion)$('#notification-status').textContent=error.message}
}
$('#open-notifications').onclick=openNotifications;
async function enableNotifications(repair=false){
 if(pushBusy||!me||!pushConfig?.available)return;const owner=me.id;pushBusy=true;$('#notification-enable').disabled=true;
 try{
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('通知は許可されませんでした。');
  const registration=await pushWorker();let sub=await registration.pushManager.getSubscription();
  const key=Uint8Array.from(atob(pushConfig.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  if(sub&&(repair||(sub.options.applicationServerKey&&String(new Uint8Array(sub.options.applicationServerKey))!==String(key)))){await api('/api/push/subscription',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();sub=null}
  if(me?.id!==owner)return;
  sub=sub||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  if(me?.id!==owner)return;
  const keys=sub.toJSON().keys;if(!keys?.p256dh||!keys?.auth)throw Error('通知の情報を取得できませんでした。「通知を登録し直す」をお試しください。');
  await api('/api/push/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint,keys})});
  if(me?.id===owner){toast('通知をオンにしました。');await openNotifications()}
 }catch(error){if(me?.id===owner){$('#notification-status').textContent=error.message;$('#notification-enable').disabled=false}}finally{pushBusy=false}
};
$('#notification-enable').onclick=()=>enableNotifications();
$('#notification-repair').onclick=()=>enableNotifications(true);
$('#notification-disable').onclick=async()=>{
 if(pushBusy||!me)return;const owner=me.id;pushBusy=true;$('#notification-disable').disabled=true;
 try{const sub=await(await pushWorker()).pushManager.getSubscription();if(sub){await api('/api/push/subscription',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe()}if(me?.id===owner){toast('通知をオフにしました。');await openNotifications()}}
 catch(error){if(me?.id===owner){$('#notification-status').textContent=error.message;$('#notification-disable').disabled=false}}finally{pushBusy=false}
};
$('#notification-test').onclick=async()=>{
 if(pushBusy||!me)return;const owner=me.id,button=$('#notification-test');pushBusy=true;button.disabled=true;
 $('#notification-status').textContent='通知サービスへの送信を確認しています…';
 try{
  const sub=await(await pushWorker()).pushManager.getSubscription();if(!sub)throw Error('通知をオンにしてから、もう一度お試しください。');
  if(me?.id!==owner)return;
  const result=await api('/api/push/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});
  if(me?.id!==owner)return;
  const messages={unregistered:'この端末の通知登録がありません。「通知を登録し直す」を押してください。',expired:'通知の登録が期限切れです。「通知を登録し直す」を押してください。',authorization:'通知サービスで認証エラーになりました。まず「通知を登録し直す」をお試しください。続く場合は管理者にお知らせください。',limited:'通知サービスが混み合っています。少し待ってからお試しください。',network:'サーバーから通知サービスに接続できませんでした。サーバーPCのインターネット接続・通信制限を確認してください。',provider:'通知サービスで送信エラーになりました。少し待ってからお試しください。'};
  $('#notification-status').textContent=result.accepted?'通知サービスが受け付けました。端末への表示はまだ確認できていません。ホーム画面に戻り、通知センターも確認してください。届かない場合は、端末の通知許可・集中モードを確認してください。':(messages[result.reason]||messages.provider)+(result.status?'（HTTP '+result.status+'）':'');
 }catch(error){if(me?.id===owner)$('#notification-status').textContent=error.message}finally{pushBusy=false;if(me?.id===owner)button.disabled=false}
};
