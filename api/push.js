/* ============================================================
   Ateena Store — API pengirim notifikasi (Web Push)
   ------------------------------------------------------------
   Dipanggil otomatis oleh aplikasi setiap ada aktivitas:
       POST /api/push   { title, body, tag, exclude }
   Fungsi ini mengirim notifikasi ke SEMUA perangkat yang sudah
   mengaktifkan "Notifikasi HP" (kecuali perangkat pengirim).

   Kenapa perlu server? Notifikasi yang tetap masuk walau
   aplikasi ditutup HARUS dikirim oleh server (Web Push).

   Kunci-kunci rahasia TIDAK ditulis di sini. Isinya diambil dari
   Vercel -> Project -> Settings -> Environment Variables:
     VAPID_PUBLIC_KEY
     VAPID_PRIVATE_KEY
     VAPID_SUBJECT   (opsional, contoh: mailto:admin@tokosaya.com)

   Data langganan perangkat disimpan di Firebase Realtime Database
   pada node: ateena/push_subs
   ============================================================ */

const webpush = require('web-push');

const DB_URL = process.env.FIREBASE_DB_URL || 'https://ateena-store-default-rtdb.asia-southeast1.firebasedatabase.app';
const SUBS_PATH = DB_URL + '/ateena/push_subs';

// Hardening ringan: CORS same-origin + rate limit per-IP.
const APP_ORIGIN = String(process.env.APP_ORIGIN || '').replace(/\/$/, '');
const RATE_WINDOW_MS = 60000;
const RATE_MAX = Math.max(1, Number(process.env.PUSH_RATE_MAX) || 8);
const MAX_BODY_BYTES = 16384;
const rateBuckets = new Map();

function originAllowed(req) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (!origin) return true;
  if (APP_ORIGIN) return origin === APP_ORIGIN;
  try {
    return new URL(origin).host === String((req.headers && req.headers.host) || '');
  } catch (e) {
    return false;
  }
}

function applyCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  res.setHeader('Vary', 'Origin');
  if (origin && originAllowed(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clientIp(req) {
  const h = req.headers || {};
  const forwarded = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(h['x-real-ip'] || '').trim() ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimit(req) {
  const now = Date.now();
  const key = clientIp(req);
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
    if (rateBuckets.size > 3000) rateBuckets.clear();
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - bucket.start)) / 1000) };
  }
  return { ok: true };
}

function safeUrl(raw) {
  const value = String(raw || '');
  if (!value) return '/';
  if (value.length > 200) return '/';
  // Hanya path relatif. Menolak "https://...", "//evil.com", "javascript:", dll.
  if (value.charAt(0) !== '/' || value.charAt(1) === '/') return '/';
  return value;
}

async function fbGet(path) {
  const r = await fetch(path + '.json');
  if (!r.ok) throw new Error('Firebase GET ' + r.status);
  return r.json();
}
async function fbDelete(path) {
  try { await fetch(path + '.json', { method: 'DELETE' }); } catch (e) {}
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (!originAllowed(req)) {
    return res.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'ateena-push',
      vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const contentLength = Number((req.headers && req.headers['content-length']) || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: 'Body permintaan terlalu besar.' });
  }
  const limited = rateLimit(req);
  if (!limited.ok) {
    res.setHeader('Retry-After', String(limited.retryAfter));
    return res.status(429).json({
      ok: false,
      error: 'Terlalu banyak notifikasi dari perangkat ini. Coba lagi dalam ' + limited.retryAfter + ' detik.'
    });
  }

  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    return res.status(500).json({ ok: false, code: 'NO_VAPID', error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum diset di Vercel Environment Variables.' });
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@ateena.local',
      pub,
      priv
    );

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    const title = String(body.title || 'Ateena Store').slice(0, 120);
    const text = String(body.body || '').slice(0, 300);
    const tag = body.tag ? String(body.tag).slice(0, 120) : undefined;
    const exclude = body.exclude ? String(body.exclude) : '';
    const url = safeUrl(body.url);

    let subs = {};
    try { subs = (await fbGet(SUBS_PATH)) || {}; } catch (e) { subs = {}; }
    const keys = Object.keys(subs);
    if (!keys.length) return res.status(200).json({ ok: true, total: 0, sent: 0, skipped: 0, removed: 0, failed: 0 });

    // Urgency tinggi + renotify bikin Android/Chrome menampilkan heads-up
    // (banner WA-like), bukan cuma ikon di status bar.
    const payload = JSON.stringify({
      title, body: text, tag, url,
      priority: 'high',
      requireInteraction: true,
      vibrate: [200, 100, 200]
    });
    const pushOptions = {
      TTL: 60 * 60,
      urgency: 'high',
      headers: { 'Urgency': 'high' }
    };
    let sent = 0, skipped = 0, removed = 0, failed = 0;

    await Promise.all(keys.map(async (k) => {
      const item = subs[k];
      const sub = item && item.subscription;
      if (!sub || !sub.endpoint) { skipped++; return; }
      if (exclude && sub.endpoint === exclude) { skipped++; return; }
      try {
        await webpush.sendNotification(sub, payload, pushOptions);
        sent++;
      } catch (err) {
        failed++;
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          removed++;
          await fbDelete(SUBS_PATH + '/' + encodeURIComponent(k));
        }
      }
    }));

    return res.status(200).json({ ok: true, total: keys.length, sent, skipped, removed, failed });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String((error && error.message) || error) });
  }
};
