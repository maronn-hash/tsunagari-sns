const emojiGroups=[
 {name:'表情',items:[['😊','笑顔'],['😄','にっこり'],['🥰','うれしい'],['😂','大笑い'],['🥹','感動'],['😎','クール'],['🤔','考え中'],['😴','おやすみ'],['😭','泣く'],['🙌','やった']]},
 {name:'気持ち・リアクション',items:[['👍','いいね'],['👏','拍手'],['🙏','ありがとう'],['💪','がんばる'],['❤️','ハート'],['💜','紫のハート'],['✨','きらきら'],['🎉','お祝い'],['🌸','桜'],['🍀','幸運']]},
 {name:'仕事・日常',items:[['☀️','晴れ'],['🌙','月'],['☕','コーヒー'],['🍰','ケーキ'],['🍜','ラーメン'],['🐱','ねこ'],['💻','パソコン'],['💡','ひらめき'],['✅','完了'],['🚀','出発']]}
];
const stickerOptions=[
 {id:'thanks',label:'ありがとう'}, {id:'goodwork',label:'おつかれさま'},
 {id:'nice',label:'いいね！'}, {id:'morning',label:'おはよう'},
 {id:'congrats',label:'おめでとう'}, {id:'hello',label:'よろしくね'}
];
let emojiSelection={start:0,end:0};
$('#emoji-groups').innerHTML=emojiGroups.map(group=>`<section class="emoji-group"><h3>${esc(group.name)}</h3><div class="emoji-grid">${group.items.map(([value,label])=>`<button type="button" data-emoji="${esc(value)}" aria-label="${esc(label)} ${esc(value)}" title="${esc(label)}">${value}</button>`).join('')}</div></section>`).join('');
$('#sticker-grid').innerHTML=stickerOptions.map(item=>`<button type="button" class="sticker-choice" data-sticker="${item.id}" aria-label="${item.label}のスタンプを追加"><img src="/sticker-${item.id}.svg" alt="" loading="lazy"><span>${item.label}</span></button>`).join('');
$('#add-emoji').onclick=()=>{
 if(busy||!me)return;const input=$('#body');emojiSelection={start:input.selectionStart,end:input.selectionEnd};$('#emoji-dialog').showModal();
};
$('#emoji-groups').onclick=e=>{
 const button=e.target.closest('[data-emoji]');if(!button||busy||!me)return;
 const input=$('#body'),emoji=button.dataset.emoji;
 if(input.value.length-(emojiSelection.end-emojiSelection.start)+emoji.length>500){toast('本文は500文字以内にしてください。');return}
 input.setRangeText(emoji,emojiSelection.start,emojiSelection.end,'end');$('#emoji-dialog').close();input.focus();updateComposer();
};
$('#add-sticker').onclick=()=>{
 if(busy||!me||selectedVideo)return;if(photos.length>=4){toast('写真とスタンプは合わせて4枚までです。');return}$('#sticker-dialog').showModal();
};
async function stickerFile(id){
 if(!stickerOptions.some(item=>item.id===id))throw Error('スタンプが見つかりません。');
 const img=new Image();img.src='/sticker-'+id+'.svg';await img.decode();
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
 canvas.getContext('2d').drawImage(img,0,0,512,512);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!blob||blob.size>3000000)throw Error('スタンプを読み込めませんでした。もう一度お試しください。');
 return new File([blob],'sticker-'+id+'.png',{type:'image/png'});
}
$('#sticker-grid').onclick=async e=>{
 const button=e.target.closest('[data-sticker]');if(!button||busy||!me||selectedVideo)return;
 if(photos.length>=4){toast('写真とスタンプは合わせて4枚までです。');return}
 const owner=me.id;busy=true;updateComposer();$('#sticker-dialog').close();
 try{const file=await stickerFile(button.dataset.sticker);if(me?.id!==owner)return;photos.push({file});attachments();toast('スタンプを追加しました。「投稿する」で送信できます。')}
 catch(e){if(me?.id===owner)toast(e.message||'スタンプを読み込めませんでした。')}
 finally{busy=false;attachments()}
};
