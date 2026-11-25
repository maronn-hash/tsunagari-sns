const calJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const calFail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
function calText(value,max){if(typeof value!=='string'||value.trim().length>max)calFail('入力内容を確認してください。');return value.trim()}
function calDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2100-12-31')calFail('日付を確認してください。');const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)calFail('日付を確認してください。');return value}
function calFields(b){
 if(!b||typeof b!=='object'||Array.isArray(b))calFail('入力内容を確認してください。');
 const title=calText(b.title,80),event_date=calDate(b.event_date),notes=calText(b.notes??'',500);
 const start_time=calText(b.start_time??'',5),end_time=calText(b.end_time??'',5);
 if(!title)calFail('予定名を入力してください。');
 for(const t of [start_time,end_time])if(t&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))calFail('時刻を確認してください。');
 if(end_time&&(!start_time||end_time<=start_time))calFail('終了時刻は開始時刻より後にしてください。');
 return {title,event_date,start_time,end_time,notes};
}
export async function handleCalendar(req,env,user){
 const url=new URL(req.url),p=url.pathname;if(p!=='/api/events'&&!p.startsWith('/api/events/'))return null;
 const db=env.DB;
 if(p==='/api/events'&&req.method==='GET'){
  const month=url.searchParams.get('month')||'';
  if(!/^\d{4}-\d{2}$/.test(month)||month<'1900-01'||month>'2100-12'||Number(month.slice(5))<1||Number(month.slice(5))>12)calFail('表示する月を確認してください。');
  const result=await db.prepare('SELECT e.*,p.name FROM calendar_events e JOIN profiles p ON p.id=e.author WHERE e.event_date>=? AND e.event_date<=? ORDER BY e.event_date,e.start_time,e.created,e.id').bind(month+'-01',month+'-31').all();
  return calJson({events:result.results.map(e=>({...e,mine:e.author===user.id}))});
 }
 if(p==='/api/events'&&req.method==='POST'){
  if(user.role!=='admin')calFail('予定を追加できるのは管理者だけです。',403);
  const b=calFields(await req.json()),id=crypto.randomUUID(),now=Date.now();
  await db.prepare('INSERT INTO calendar_events(id,author,title,event_date,start_time,end_time,notes,created,updated) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,user.id,b.title,b.event_date,b.start_time,b.end_time,b.notes,now,now).run();
  return calJson({id},201);
 }
 const match=p.match(/^\/api\/events\/([a-f0-9-]{36})$/);if(!match)calFail('見つかりません。',404);
 const event=await db.prepare('SELECT * FROM calendar_events WHERE id=?').bind(match[1]).first();if(!event)calFail('予定が見つかりません。',404);
 if(!['PATCH','DELETE'].includes(req.method))calFail('対応していない操作です。',405);
 if(event.author!==user.id)calFail('変更・削除できるのは自分が登録した予定だけです。',403);
 if(req.method==='DELETE'){await db.prepare('DELETE FROM calendar_events WHERE id=? AND author=?').bind(event.id,user.id).run();return calJson({ok:true})}
 const b=calFields(await req.json());
 await db.prepare('UPDATE calendar_events SET title=?,event_date=?,start_time=?,end_time=?,notes=?,updated=? WHERE id=? AND author=?').bind(b.title,b.event_date,b.start_time,b.end_time,b.notes,Date.now(),event.id,user.id).run();
 return calJson({ok:true});
}

