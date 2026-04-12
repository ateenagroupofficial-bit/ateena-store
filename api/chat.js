const https = require('https');

function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = JSON.stringify(data);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch (e) {
          resolve({ status: res.statusCode, data: { error: responseData } });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY tidak ditemukan di Environment Variables.' });
  }

  try {
    const { system, messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Format Groq: sama dengan OpenAI
    const groqMessages = [];

    // Tambahkan system prompt
    if (system) {
      groqMessages.push({ role: 'system', content: system });
    }

    // Tambahkan semua pesan
    messages.forEach(msg => {
      groqMessages.push({ role: msg.role, content: msg.content });
    });

    const result = await httpsPost(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        max_tokens: 1000,
        temperature: 0.7
      },
      {
        'Authorization': 'Bearer ' + apiKey
      }
    );

    const groqData = result.data;

    if (groqData.error) {
      return res.status(400).json({ error: groqData.error.message || JSON.stringify(groqData.error) });
    }

    const replyText = groqData?.choices?.[0]?.message?.content || 'Maaf, tidak ada respons.';

    // Kembalikan dalam format yang sama dengan Anthropic agar index.html tidak perlu diubah
    return res.status(200).json({
      content: [{ type: 'text', text: replyText }]
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};
