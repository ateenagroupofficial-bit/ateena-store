/* ============================================================
   Ateena Store — API proxy "Tanya AI"
   ------------------------------------------------------------
   Mendukung 3 penyedia. Pilih salah satu lewat Environment
   Variables di Vercel (tidak perlu ubah index.html):

   1) GROQ (disarankan — gratis, tanpa kartu kredit)
        GROQ_API_KEY     = gsk_...
        GROQ_MODEL       = openai/gpt-oss-120b   (opsional)
        Kuota gratis: +/- 1.000 permintaan/hari.

   2) GOOGLE GEMINI (gratis dalam kuota, tanpa kartu kredit)
        GEMINI_API_KEY   = ...
        GEMINI_MODEL     = gemini-2.5-flash      (opsional)

   3) ANTHROPIC (berbayar per token)
        ANTHROPIC_API_KEY = sk-ant-...
        ANTHROPIC_MODEL   = claude-haiku-5-5     (opsional)

   Urutan otomatis: Groq -> Gemini -> Anthropic.
   Untuk memaksa salah satu: AI_PROVIDER=groq|gemini|anthropic

   GET /api/chat hanya untuk diagnostik: memberi tahu penyedia
   mana yang aktif, tanpa pernah menampilkan API key.
   ============================================================ */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const MAX_TOKENS_CAP = 1500;
const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MSG = 8000;
const TIMEOUT_MS = 45000;

const PROVIDERS = {
  groq: {
    label: 'Groq',
    free: true,
    key: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
  },
  gemini: {
    label: 'Google Gemini',
    free: true,
    key: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  },
  anthropic: {
    label: 'Anthropic',
    free: false,
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5'
  }
};

function pickProvider() {
  const forced = String(process.env.AI_PROVIDER || '').toLowerCase().trim();
  if (forced && PROVIDERS[forced] && PROVIDERS[forced].key) return forced;
  if (PROVIDERS.groq.key) return 'groq';
  if (PROVIDERS.gemini.key) return 'gemini';
  if (PROVIDERS.anthropic.key) return 'anthropic';
  return null;
}

function json(res, status, body) {
  return res.status(status).json(body);
}

function normalizeMessages(rawMessages) {
  return rawMessages.slice(-MAX_MESSAGES).map(function (m) {
    const role = m && m.role === 'assistant' ? 'assistant' : 'user';
    let content = m && m.content;
    if (typeof content !== 'string') content = '';
    content = content.slice(0, MAX_CHARS_PER_MSG);
    return { role: role, content: content };
  }).filter(function (m) { return m.content.trim().length > 0; });
}

async function callGroq(provider, system, messages, maxTokens, signal) {
  const upstream = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + provider.key
    },
    signal: signal,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [{ role: 'system', content: system }].concat(messages)
    })
  });
  return upstream;
}

async function callGemini(provider, system, messages, maxTokens, signal) {
  const contents = messages.map(function (m) {
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    };
  });
  const url = GEMINI_BASE + '/' + encodeURIComponent(provider.model) +
    ':generateContent?key=' + encodeURIComponent(provider.key);
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: signal,
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.4
      }
    })
  });
  return upstream;
}

async function callAnthropic(provider, system, messages, maxTokens, signal) {
  return fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.key,
      'anthropic-version': '2023-06-01'
    },
    signal: signal,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      system: system,
      messages: messages
    })
  });
}

function normalizeReply(name, data) {
  if (name === 'groq') {
    const text = (data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content) || '';
    return { content: [{ type: 'text', text: text }] };
  }
  if (name === 'gemini') {
    const parts = (data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map(function (p) { return p && p.text ? p.text : ''; }).join('');
    return { content: [{ type: 'text', text: text }] };
  }
  return data;
}

function providerErrorMessage(name, status, data) {
  if (status === 429) {
    return 'Kuota gratis ' + (PROVIDERS[name] ? PROVIDERS[name].label : name) +
      ' sedang habis/terlalu cepat. Tunggu beberapa menit atau ganti penyedia.';
  }
  if (data && data.error) {
    if (typeof data.error === 'string') return data.error;
    if (data.error.message) return data.error.message;
  }
  return 'Layanan AI mengembalikan HTTP ' + status + '.';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const active = pickProvider();

  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'ateena-chat',
      provider: active,
      configured: !!active,
      model: active ? PROVIDERS[active].model : null,
      freeTier: active ? !!PROVIDERS[active].free : false,
      note: active
        ? 'Penyedia AI sudah terbaca. Fitur Tanya AI siap dipakai.'
        : 'Belum ada API key. Set GROQ_API_KEY (gratis) atau GEMINI_API_KEY di Vercel Environment Variables.'
    });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  if (!active) {
    return json(res, 500, {
      error: 'Belum ada API key AI. Set GROQ_API_KEY (gratis, tanpa kartu kredit) atau GEMINI_API_KEY di Vercel Environment Variables, lalu Redeploy.'
    });
  }

  const provider = PROVIDERS[active];

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    if (!body || typeof body !== 'object') {
      return json(res, 400, { error: 'Body permintaan tidak valid.' });
    }

    const rawMessages = body.messages;
    if (!Array.isArray(rawMessages) || !rawMessages.length) {
      return json(res, 400, { error: 'messages harus berupa array dan tidak boleh kosong.' });
    }

    const messages = normalizeMessages(rawMessages);
    if (!messages.length) {
      return json(res, 400, { error: 'Tidak ada pesan yang bisa diproses.' });
    }

    const maxTokens = Math.min(
      Math.max(Number(body.max_tokens) || 1000, 1),
      MAX_TOKENS_CAP
    );
    const system = typeof body.system === 'string' ? body.system.slice(0, 20000) : '';

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    let upstream;
    try {
      const call = active === 'groq' ? callGroq
        : active === 'gemini' ? callGemini
        : callAnthropic;
      upstream = await call(provider, system, messages, maxTokens, controller.signal);
    } finally {
      clearTimeout(timer);
    }

    const raw = await upstream.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return json(res, 502, {
        error: 'Respons ' + provider.label + ' tidak valid (HTTP ' + upstream.status + ').',
        detail: raw.slice(0, 300)
      });
    }

    if (!upstream.ok) {
      return json(res, upstream.status, {
        error: providerErrorMessage(active, upstream.status, data),
        provider: active,
        detail: data
      });
    }

    const reply = normalizeReply(active, data);
    return json(res, 200, {
      content: reply.content,
      provider: active,
      model: provider.model,
      freeTier: !!provider.free
    });
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
    return json(res, aborted ? 504 : 500, {
      error: aborted
        ? 'Permintaan ke AI melebihi batas waktu. Coba lagi.'
        : 'Gagal menghubungi layanan AI.',
      message: String((error && error.message) || error)
    });
  }
};
