// غيّر رقم الإصدار ده مع كل رفع، عشان الكاش القديم يتمسح
const CACHE_NAME = 'anees-quran-v18';

// الملفات اللي التطبيق محتاجها عشان يشتغل من غير نت
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './fonts/amiri-arabic-400-normal.woff2',
  './fonts/thmanyahserifdisplay-Light.otf',
  './fonts/thmanyahserifdisplay-Regular.otf',
  './fonts/thmanyahserifdisplay-Medium.otf',
  './fonts/thmanyahserifdisplay-Bold.otf',
  './fonts/thmanyahserifdisplay-Black.otf',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // كل ملف لوحده: لو ملف واحد مش موجود، الباقي يتحفظ عادي
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // الصفحة نفسها: من النت الأول عشان التحديثات توصل فوراً، والنسخة المحفوظة لو مفيش نت
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((res) => res || caches.match('./')))
    );
    return;
  }

  // باقي الملفات: المحفوظة فوراً، وفي الخلفية تتحدث من النت للمرة الجاية
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
