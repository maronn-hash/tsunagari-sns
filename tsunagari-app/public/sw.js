self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// Private posts, names and photos are never stored in a service-worker cache.
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>つながり</title><body style="font-family:sans-serif;text-align:center;padding:80px 24px;background:#f8f9fb;color:#7560b6"><h1>接続をお待ちしています</h1><p>インターネットにつないでから、もう一度開いてください。</p><a href="/">再読み込み</a></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})))});

function notificationPath(value){return typeof value==='string'&&/^\/\?post=[a-f0-9-]{36}$/.test(value)?value:'/'}
// Browsers decrypt the Web Push payload before dispatching this event.
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let title='つながり',body='新しい投稿・返信・お知らせがあります。開いて確認してください。',url='/';
 try{const message=event.data?.json();if(message?.version===1&&typeof message.title==='string'&&typeof message.body==='string'){
  title=Array.from(message.title).slice(0,100).join('')||title;body=Array.from(message.body).slice(0,160).join('')||body;url=notificationPath(message.url);
 }}catch{/* Old subscriptions and malformed data still show a generic notification. */}
 await self.registration.showNotification(title,{body,icon:'/icon-192.png',badge:'/icon-192.png',data:{url}});
})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
 const target=new URL(notificationPath(event.notification.data?.url),self.location.origin).href;
 const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const client of windows){if(new URL(client.url).origin===self.location.origin){try{const navigated=await client.navigate(target);if(navigated)return navigated.focus()}catch{/* Try another window or open a new one. */}}}
 return self.clients.openWindow(target);
})())});
