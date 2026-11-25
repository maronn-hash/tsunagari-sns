const videoFail=message=>{throw Object.assign(Error(message),{status:400})};
// Read bounded ISO-BMFF boxes; accepting MP4 only keeps phone playback predictable.
function mp4Boxes(bytes,start=0,end=bytes.length){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=[];let pos=start;
 while(pos<end){
  if(pos+8>end||result.length>10000)videoFail('動画ファイルを読み取れません。');
  let size=view.getUint32(pos),header=8;
  if(size===1){if(pos+16>end)videoFail('動画ファイルを読み取れません。');size=Number(view.getBigUint64(pos+8));header=16}
  if(size===0)size=end-pos;
  if(!Number.isSafeInteger(size)||size<header||pos+size>end)videoFail('動画ファイルを読み取れません。');
  result.push({type:new TextDecoder().decode(bytes.subarray(pos+4,pos+8)),start:pos+header,end:pos+size});pos+=size;
 }return result;
}
export function validateVideo(bytes){
 if(bytes.length>20000000)videoFail('動画は20MB以内にしてください。');
 const boxes=mp4Boxes(bytes),ftyp=boxes.find(b=>b.type==='ftyp'),moov=boxes.find(b=>b.type==='moov');
 if(!ftyp||!moov||!boxes.some(b=>b.type==='mdat')||ftyp.end-ftyp.start<8)videoFail('MP4形式の動画を選んでください。');
 const brand=new TextDecoder().decode(bytes.subarray(ftyp.start,ftyp.start+4));
 if(!['isom','iso2','mp41','mp42','avc1','M4V ','MSNV'].includes(brand))videoFail('MP4形式で書き出した動画を選んでください。');
 const children=mp4Boxes(bytes,moov.start,moov.end),mvhd=children.find(b=>b.type==='mvhd');
 if(!mvhd)videoFail('動画の長さを確認できません。MP4で書き出し直してください。');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),version=bytes[mvhd.start];
 if(![0,1].includes(version)||mvhd.end-mvhd.start<(version===1?32:20))videoFail('動画の長さを確認できません。');
 const scale=view.getUint32(mvhd.start+(version===1?20:12)),duration=version===1?Number(view.getBigUint64(mvhd.start+24)):view.getUint32(mvhd.start+16);
 if(!scale||!Number.isSafeInteger(duration)||duration<=0||duration/scale>60)videoFail('動画は60秒以内にしてください。');
 const hasVideo=children.filter(b=>b.type==='trak').some(track=>mp4Boxes(bytes,track.start,track.end).filter(b=>b.type==='mdia').some(mdia=>mp4Boxes(bytes,mdia.start,mdia.end).some(b=>b.type==='hdlr'&&b.end-b.start>=12&&new TextDecoder().decode(bytes.subarray(b.start+8,b.start+12))==='vide')));
 if(!hasVideo)videoFail('映像を含むMP4動画を選んでください。');
 return {bytes,ext:'mp4'};
}
export async function serveVideo(file,req){
 const bytes=new Uint8Array(await new Response(file.body).arrayBuffer()),size=bytes.length;
 const headers={'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Length':String(size)};
 const range=req.headers.get('range');if(!range)return new Response(req.method==='HEAD'?null:bytes,{headers});
 const match=range.match(/^bytes=(\d*)-(\d*)$/);let start,end;
 if(match&&(match[1]||match[2])){start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return new Response(null,{status:416,headers:{...headers,'Content-Length':'0','Content-Range':`bytes */${size}`}});
 return new Response(req.method==='HEAD'?null:bytes.slice(start,end+1),{status:206,headers:{...headers,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${size}`}});
}
