function syncMobileTopics(){
 $('#mobile-topics').classList.toggle('active',!!category);
 $$('[data-mobile-topic]').forEach(button=>{const selected=button.dataset.mobileTopic===category;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});
}
$('#mobile-topics').onclick=()=>{if(!me)return;syncMobileTopics();$('#topics-dialog').showModal()};
$('#mobile-topic-list').onclick=e=>{
 const button=e.target.closest('[data-mobile-topic]');if(!button||!me)return;
 category=button.dataset.mobileTopic;$('#topics-dialog').close();setMode('all');syncMobileTopics();
 document.querySelector('.feed-header').scrollIntoView({behavior:'smooth',block:'start'});
};
// Leave pinch zoom available. Only avoid covering form fields with the floating button.
document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea,select'))$('#mobile-compose').classList.add('editing')});
document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches('input,textarea,select'))$('#mobile-compose').classList.remove('editing')},0));
