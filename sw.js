/* ============================================================
   Ateena Store — Service Worker (notifikasi)
   ------------------------------------------------------------
   Kenapa perlu file ini?
   Di Android, "new Notification()" DILARANG oleh browser
   (TypeError: Illegal constructor). Satu-satunya cara menampilkan
   notifikasi di HP adalah lewat Service Worker ini
   (registration.showNotification).

   Service worker ini juga menangkap "push" yang dikirim server
   (/api/push) sehingga notifikasi tetap masuk walau aplikasi
   sedang ditutup total.
   ============================================================ */

var ATN_ICON = 'data:image/webp;base64,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';

self.addEventListener('install', function(){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(self.clients.claim());
});

function atnShowNotification(payload){
  var d = payload || {};
  var opts = {
    body: d.body || '',
    tag: d.tag || ('ateena-' + Date.now()),
    renotify: false,
    data: { url: d.url || '/' }
  };
  if (ATN_ICON && ATN_ICON.indexOf('data:') === 0) {
    opts.icon = ATN_ICON;
    opts.badge = ATN_ICON;
  }
  return self.registration.showNotification(d.title || 'Ateena Store', opts);
}

// Notifikasi yang dikirim dari server (Web Push) — inilah yang bikin
// notifikasi tetap muncul walau aplikasi ditutup.
self.addEventListener('push', function(e){
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    try { data = { body: e.data.text() }; } catch (e2) { data = {}; }
  }
  e.waitUntil(atnShowNotification(data));
});

// Boleh juga dipanggil dari halaman lewat postMessage (cadangan).
self.addEventListener('message', function(e){
  var d = e.data || {};
  if (d && d.type === 'ateena-notif') {
    atnShowNotification(d);
  }
});

// Klik notifikasi → fokuskan aplikasi yang sudah terbuka, atau buka baru.
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) {
          try { list[i].focus(); } catch (err) {}
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
