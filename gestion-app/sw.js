const CACHE='maloe-gestion-v2-edl';const ASSETS=['./manifest.webmanifest','../images/logo-hero.webp'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('maloe-gestion-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
if(event.request.mode==='navigate'||new URL(event.request.url).pathname.endsWith('/gestion-app/index.html')){event.respondWith(fetch(event.request,{cache:'no-store'}));return}
event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});