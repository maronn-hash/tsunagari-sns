const profileJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const profileError=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
function profileText(value,max,label){if(typeof value!=='string')profileError(`${label}の入力内容を確認してください。`);const normalized=value.replace(/\r\n?/g,'\n').trim();if(normalized.length>max)profileError(`${label}は${max}文字以内で入力してください。`);return normalized}
async function profileImage(file){
 if(typeof file==='string'||!file||file.size===0||file.size>3000000)profileError('プロフィール画像は1枚3MB以内にしてください。');
 const bytes=new Uint8Array(await file.arrayBuffer());let ext='';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';
 if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))ext='png';
 if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')ext='webp';
 if(!ext)profileError('JPEG・PNG・WebPの画像を選んでください。');
 return {bytes,ext};
}
export async function handleProfiles(req,env,user){
 const p=new URL(req.url).pathname,match=p.match(/^\/api\/profiles\/([a-f0-9-]+)$/);
 if(p!=='/api/me'&&!match)return null;
 const db=env.DB;
 if(req.method==='GET'){
  const id=match?match[1]:user.id;
  const profile=await db.prepare('SELECT p.id,p.name,p.bio,p.location,p.avatar_key,p.header_key,a.username,(SELECT count(*) FROM posts WHERE author=p.id AND hidden=0) AS post_count FROM profiles p JOIN accounts a ON a.user_id=p.id WHERE p.id=?').bind(id).first();
  if(!profile)profileError('プロフィールが見つかりません。',404);
  return profileJSON({...profile,...(!match?{role:user.role}:{})});
 }
 if(p!=='/api/me'||req.method!=='PATCH')return profileJSON({error:'対応していない操作です。'},405);
 const current=await db.prepare('SELECT * FROM profiles WHERE id=?').bind(user.id).first();
 const multipart=(req.headers.get('content-type')||'').startsWith('multipart/form-data');
 const form=multipart?await req.formData():null;
 const b=form?Object.fromEntries(['name','bio','location'].filter(k=>form.has(k)).map(k=>[k,form.get(k)])):await req.json();
 if(!b||typeof b!=='object'||Array.isArray(b))profileError('プロフィールの入力内容を確認してください。');
 const fields=[],values=[],uploads=[],oldKeys=[];
 for(const [key,max,label] of [['name',40,'表示名'],['bio',160,'自己紹介'],['location',30,'場所']]){
  if(!Object.hasOwn(b,key))continue;
  const v=profileText(b[key],max,label);
  if(key==='name'&&!v)profileError('表示名を入力してください。');fields.push(key+'=?');values.push(v);
 }
 for(const key of ['avatar','header']){
  const files=form?.getAll(key)||[],remove=form?.get('remove_'+key)==='1';
  if(files.length>1||(files.length&&remove))profileError('画像の指定を確認してください。');
  if(!files.length&&!remove)continue;
  const column=key+'_key';oldKeys.push(current[column]);fields.push(column+'=?');
  if(remove){values.push('');continue}
  const image=await profileImage(files[0]),storedKey=crypto.randomUUID()+'/0.'+image.ext;
  values.push(storedKey);uploads.push({...image,key:storedKey});
 }
 if(!fields.length)profileError('変更する内容を入力してください。');
 const written=[];
 try{
  for(const image of uploads){await env.BUCKET.put(image.key,image.bytes,{httpMetadata:{contentType:image.ext==='jpg'?'image/jpeg':'image/'+image.ext}});written.push(image.key)}
  await db.prepare('UPDATE profiles SET '+fields.join(',')+' WHERE id=?').bind(...values,user.id).run();
 }catch(e){await Promise.allSettled(written.map(key=>env.BUCKET.delete(key)));throw e}
 // Images are immutable. Only remove old files after saving the replacement.
 for(const key of oldKeys.filter(Boolean)){
  const referenced=await db.prepare('SELECT id FROM profiles WHERE avatar_key=? OR header_key=? LIMIT 1').bind(key,key).first();
  if(!referenced)await env.BUCKET.delete(key).catch(()=>{});
 }
 return profileJSON({ok:true});
}
