// CRGT offline: everything the app needs is kept on the device at install, and served from there first,
// so it opens and plays with no connection. A new version replaces it on the first launch while online.
const CACHE='crgt-v48-b82dff984d';
const FILES=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting())); });   // fresh from the site, never an older copy
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE && k.startsWith('crgt-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url); if(u.origin!==location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(r.mode==='navigate'?'index.html':r,{ignoreSearch:true});
    if(hit) return hit;
    try{ const res=await fetch(r); if(res && res.ok) c.put(r,res.clone()); return res; }
    catch(err){ return (await c.match('index.html'))||new Response('CRGT is offline and this file was never saved.',{status:503}); }
  }));
});
