function linkedPostId(){const value=new URLSearchParams(window.location.search).get('post')||'';return /^[a-f0-9-]{36}$/.test(value)?value:''}
function clearLinkedPost(){if(!linkedPostId())return;const url=new URL(window.location.href);url.searchParams.delete('post');window.history.replaceState(null,'',url.pathname+url.search+url.hash);$('#notification-post-banner').hidden=true}
function syncLinkedPost(){const id=linkedPostId();$('#notification-post-banner').hidden=!id;return id}
$('#notification-post-back').onclick=()=>{clearLinkedPost();category='';$('#search').value='';setMode('all')};
// Returning to a normal view should no longer restrict the feed to one post.
document.addEventListener('click',e=>{if(e.target.closest('[data-mode],[data-category],[data-mobile-topic],#tab-all,#tab-images,#mobile-topics,#mobile-compose,#compose-shortcut,#publish,#clear-filter'))clearLinkedPost()},true);
$('#search').addEventListener('input',clearLinkedPost);
window.addEventListener('popstate',()=>{if(me)load()});
