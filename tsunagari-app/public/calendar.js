let calendarMonth='',calendarSelected='',calendarEvents=[],calendarRequest=0,calendarEditId='',calendarSaving=false;
function calendarToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=t=>parts.find(p=>p.type===t).value;return part('year')+'-'+part('month')+'-'+part('day')}
function resetCalendar(){$('#side-calendar-grid').replaceChildren();$('#side-calendar-agenda').replaceChildren();$('#side-calendar-status').textContent='';$('#side-calendar-month').textContent='';$('#side-calendar-date').textContent='';calendarRequest++;calendarEvents=[];calendarEditId='';calendarMonth='';calendarSelected='';$('#calendar-grid').replaceChildren();$('#calendar-events').replaceChildren();$('#event-form').reset()}
function renderCalendar(){
 $('#calendar-add').hidden=me?.role!=='admin';
 const [year,month]=calendarMonth.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1)).getUTCDay(),days=new Date(Date.UTC(year,month,0)).getUTCDate(),today=calendarToday();
 $('#calendar-month').textContent=year+'年'+month+'月';$('#calendar-prev').disabled=calendarMonth==='1900-01';$('#calendar-next').disabled=calendarMonth==='2100-12';
 let html=['日','月','火','水','木','金','土'].map(d=>'<span class="calendar-weekday">'+d+'</span>').join('')+'<span aria-hidden="true"></span>'.repeat(first);
 for(let n=1;n<=days;n++){const date=calendarMonth+'-'+String(n).padStart(2,'0'),events=calendarEvents.filter(e=>e.event_date===date);html+='<button type="button" class="calendar-day '+(date===calendarSelected?'selected ':'')+(date===today?'today':'')+'" data-calendar-date="'+date+'" aria-pressed="'+(date===calendarSelected)+'" '+(date===today?'aria-current="date" ':'')+'aria-label="'+date+'、予定'+events.length+'件"><span class="calendar-number">'+n+'</span>'+(events.length?'<small>'+esc(events[0].title)+'</small>'+(events.length>1?'<small>ほか'+(events.length-1)+'件</small>':''):'')+'</button>'}
 $('#calendar-grid').innerHTML=html;renderCalendarAgenda();
}
function renderCalendarAgenda(){
 renderSideCalendar();
 $('#calendar-date-title').textContent=calendarSelected.replaceAll('-',' / ')+' の予定';
 const events=calendarEvents.filter(e=>e.event_date===calendarSelected);
 $('#calendar-events').innerHTML=events.length?events.map(e=>'<button type="button" class="calendar-event" data-event-id="'+esc(e.id)+'"><strong>'+esc(e.title)+'</strong><small>'+esc(e.start_time?(e.start_time+(e.end_time?' 〜 '+e.end_time:'')):'終日')+' · '+esc(e.name)+'</small></button>').join(''):'<p class="calendar-note">この日の予定はありません。</p>';
}
async function loadCalendar(){
 const version=++calendarRequest,owner=me?.id;calendarEvents=[];renderCalendar();$('#calendar-status').textContent='予定を読み込んでいます…';$('#calendar-status').className='calendar-note';$('#side-calendar-status').textContent='予定を読み込んでいます…';
 try{const data=await api('/api/events?month='+calendarMonth);if(version!==calendarRequest||me?.id!==owner)return;calendarEvents=data.events;renderCalendar();$('#calendar-status').textContent=calendarEvents.length+'件の予定';$('#side-calendar-status').textContent='今月の予定 '+calendarEvents.length+'件'}
 catch(e){if(version!==calendarRequest||me?.id!==owner)return;$('#side-calendar-status').textContent='予定を読み込めませんでした。「更新」で再試行できます。';$('#side-calendar-agenda').replaceChildren();$('#calendar-status').className='calendar-error';$('#calendar-status').textContent=e.message;$('#calendar-events').textContent='予定を取得できませんでした。「再読み込み」をお試しください。'}
}
function openCalendar(date){if(!me)return;calendarSelected=typeof date==='string'?date:(calendarSelected||calendarToday());calendarMonth=calendarSelected.slice(0,7);if(!$('#calendar-dialog').open)$('#calendar-dialog').showModal();loadCalendar()}
$$('.calendar-open').forEach(b=>b.onclick=openCalendar);
function moveCalendar(delta){const [year,month]=calendarMonth.split('-').map(Number),date=new Date(Date.UTC(year,month-1+delta,1));calendarMonth=date.toISOString().slice(0,7);calendarSelected=calendarMonth+'-01';loadCalendar()}
$('#calendar-prev').onclick=()=>moveCalendar(-1);$('#calendar-next').onclick=()=>moveCalendar(1);
$('#calendar-today').onclick=()=>{calendarSelected=calendarToday();calendarMonth=calendarSelected.slice(0,7);loadCalendar()};
$('#calendar-reload').onclick=loadCalendar;
$('#calendar-grid').onclick=e=>{const b=e.target.closest('[data-calendar-date]');if(b){calendarSelected=b.dataset.calendarDate;renderCalendar()}};
function editCalendarEvent(event=null){
 if(calendarSaving||!me||(!event&&me.role!=='admin'))return;
 if(me.role==='admin'&&typeof openAdminPage==='function'){openAdminPage('calendar');return}calendarEditId=event?.id||'';const readonly=event&&!event.mine;
 $('#calendar-editor-title').textContent=event?(readonly?'予定の詳細':'予定を編集'):'予定を追加';
 $('#event-title').value=event?.title||'';$('#event-date').value=event?.event_date||calendarSelected;$('#event-start').value=event?.start_time||'';$('#event-end').value=event?.end_time||'';$('#event-notes').value=event?.notes||'';
 $('#event-fields').disabled=!!readonly;$('#event-owner').textContent=event?'登録者：'+event.name:'メンバー全員のカレンダーに表示されます。';$('#event-save').hidden=!!readonly;$('#event-save').disabled=false;$('#event-delete').hidden=!event||!!readonly;$('#event-delete').disabled=false;$('#event-confirm-delete').disabled=false;$('#event-delete-check').hidden=true;$('#event-error').textContent='';$('#calendar-editor').showModal()
}
$('#calendar-add').onclick=()=>editCalendarEvent();$('#calendar-events').onclick=e=>{const b=e.target.closest('[data-event-id]');if(b)editCalendarEvent(calendarEvents.find(x=>x.id===b.dataset.eventId))};
$('#event-form').onsubmit=async e=>{
 e.preventDefault();if(calendarSaving||!me||(!calendarEditId&&me.role!=='admin'))return;
 const owner=me.id,id=calendarEditId,body={title:$('#event-title').value,event_date:$('#event-date').value,start_time:$('#event-start').value,end_time:$('#event-end').value,notes:$('#event-notes').value};
 calendarSaving=true;$('#event-save').disabled=true;$('#event-delete').disabled=true;$('#event-error').textContent='';
 try{await api('/api/events'+(id?'/'+id:''),{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(me?.id!==owner)return;$('#calendar-editor').close();calendarSelected=body.event_date;calendarMonth=body.event_date.slice(0,7);await loadCalendar();toast(id?'予定を更新しました。':'予定を追加しました。')}
 catch(e){if(me?.id===owner)$('#event-error').textContent=e.message}
 finally{calendarSaving=false;$('#event-save').disabled=false;$('#event-delete').disabled=false}
};
$('#event-delete').onclick=()=>{$('#event-delete-check').hidden=false};
$('#event-cancel-delete').onclick=()=>{$('#event-delete-check').hidden=true};
$('#event-confirm-delete').onclick=async()=>{
 if(calendarSaving||!me||!calendarEditId)return;const owner=me.id,id=calendarEditId;calendarSaving=true;$('#event-save').disabled=true;$('#event-confirm-delete').disabled=true;
 try{await api('/api/events/'+id,{method:'DELETE'});if(me?.id!==owner)return;$('#calendar-editor').close();await loadCalendar();toast('予定を削除しました。')}
 catch(e){if(me?.id===owner)$('#event-error').textContent=e.message}
 finally{calendarSaving=false;$('#event-save').disabled=false;$('#event-confirm-delete').disabled=false}
};


function initCalendar(){calendarSelected=calendarToday();calendarMonth=calendarSelected.slice(0,7);loadCalendar()}
function renderSideCalendar(){
 const [year,month]=calendarMonth.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1)).getUTCDay(),days=new Date(Date.UTC(year,month,0)).getUTCDate(),today=calendarToday();
 $('#side-calendar-month').textContent=year+'年'+month+'月';
 $('#side-calendar-prev').disabled=calendarMonth==='1900-01';$('#side-calendar-next').disabled=calendarMonth==='2100-12';
 let html=['日','月','火','水','木','金','土'].map(day=>'<span class="side-calendar-weekday">'+day+'</span>').join('')+'<span aria-hidden="true"></span>'.repeat(first);
 for(let n=1;n<=days;n++){
  const date=calendarMonth+'-'+String(n).padStart(2,'0'),count=calendarEvents.filter(e=>e.event_date===date).length;
  html+='<button type="button" class="side-calendar-day '+(date===today?'today ':'')+(date===calendarSelected?'selected':'')+'" data-side-date="'+date+'" '+(date===today?'aria-current="date" ':'')+'aria-label="'+date+'、予定'+count+'件。予定を開く"><span>'+n+'</span><i class="'+(count?'has-events':'')+'" aria-hidden="true"></i></button>';
 }
 $('#side-calendar-grid').innerHTML=html;
 $('#side-calendar-date').textContent=Number(calendarSelected.slice(5,7))+'月'+Number(calendarSelected.slice(8))+'日の予定';
 const events=calendarEvents.filter(e=>e.event_date===calendarSelected);
 $('#side-calendar-agenda').innerHTML=events.length?events.slice(0,3).map(e=>'<button type="button" class="side-calendar-event" data-side-event="'+esc(e.id)+'"><small>'+esc(e.start_time?(e.start_time+(e.end_time?' 〜 '+e.end_time:'')):'終日')+'</small><span>'+esc(e.title)+'</span></button>').join('')+(events.length>3?'<button type="button" id="side-calendar-more">ほか'+(events.length-3)+'件を見る</button>':''):'<p class="side-calendar-empty">予定はありません</p>';
 $('#side-calendar-more')?.addEventListener('click',()=>openCalendar(calendarSelected));
}
$('#side-calendar-grid').onclick=e=>{const b=e.target.closest('[data-side-date]');if(b)openCalendar(b.dataset.sideDate)};
$('#side-calendar-agenda').onclick=e=>{const b=e.target.closest('[data-side-event]');if(b)openCalendar(calendarSelected)};
$('#side-calendar-prev').onclick=()=>moveCalendar(-1);$('#side-calendar-next').onclick=()=>moveCalendar(1);
$('#side-calendar-today').onclick=()=>initCalendar();
$('#side-calendar-reload').onclick=()=>loadCalendar();
$('#side-calendar-open').onclick=()=>openCalendar(calendarSelected);
