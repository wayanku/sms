const CACHE_NAME = 'chat-plus-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/chat.js',
  '/contacts.js',
  '/calls.js',
  '/ui.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  // Jangan cache permintaan API Supabase atau PeerJS
  if (e.request.url.includes('supabase.co') || e.request.url.includes('peerjs')) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
