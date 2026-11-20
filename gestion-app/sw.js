const CACHE='maloe-gestion-v5-lancement';const ASSETS=['./manifest.webmanifest','../images/logo-hero.webp'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('maloe-gestion-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
if(event.request.mode==='navigate'||new URL(event.request.url).pathname===new URL('./version.json',self.registration.scope).pathname){event.respondWith(fetch(event.request,{cache:'no-store'}));return}
event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=new URL('./lancer',self.registration.scope).href;event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{for(const w of windows){if(w.url.startsWith(self.registration.scope)){await w.focus();return}}await self.clients.openWindow(url)}))});

self.addEventListener('push',event=>{let data={};try{data=event.data?.json()||{}}catch{}event.waitUntil(self.registration.showNotification(data.title||'Maloé Gestion',{body:data.body||'Nouvelle alerte',icon:'../images/logo-hero.webp',badge:'../images/logo-hero.webp',tag:data.tag||'maloe-alert',data:{url:'./lancer'}}))});
