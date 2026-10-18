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

async function fbGet(path) {
  const r = await fetch(path + '.json');
  if (!r.ok) throw new Error('Firebase GET ' + r.status);
  return r.json();
}
async function fbDelete(path) {
  try { await fetch(path + '.json', { method: 'DELETE' }); } catch (e) {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'ateena-push',
      vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    const url = body.url ? String(body.url) : '/';

    let subs = {};
    try { subs = (await fbGet(SUBS_PATH)) || {}; } catch (e) { subs = {}; }
    const keys = Object.keys(subs);
    if (!keys.length) return res.status(200).json({ ok: true, total: 0, sent: 0, skipped: 0, removed: 0, failed: 0 });

    const payload = JSON.stringify({ title, body: text, tag, url });
    let sent = 0, skipped = 0, removed = 0, failed = 0;

    await Promise.all(keys.map(async (k) => {
      const item = subs[k];
      const sub = item && item.subscription;
      if (!sub || !sub.endpoint) { skipped++; return; }
      if (exclude && sub.endpoint === exclude) { skipped++; return; }
      try {
        await webpush.sendNotification(sub, payload);
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
