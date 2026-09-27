// Service worker: what lets browsers offer "Install Chat Club" as an app.
//
// Deliberately minimal. Only the app's own page is handled, always from the
// network first (so a deploy shows up immediately, never a stale copy), with
// the last good copy kept only as an offline fallback. Firebase, fonts and
// every other request pass straight through untouched.

const CACHE = "chat-club-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for(const key of await caches.keys()) if(key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if(req.mode !== "navigate" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try{
      const res = await fetch(req);
      if(res.ok){
        const cache = await caches.open(CACHE);
        cache.put("/", res.clone());
      }
      return res;
    } catch(err){
      const cached = await caches.match("/");
      return cached || new Response("You're offline — Chat Club needs the internet.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
