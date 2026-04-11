module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY tidak ditemukan.' });
  }

  try {
    const { system, messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages harus berupa array' });
    }

    const systemText = system ? system + '\n\n' : '';

    const geminiContents = messages.map((msg, index) => {
      let text = msg.content;
      if (index === 0 && msg.role === 'user' && systemText) {
        text = systemText + text;
      }
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: text }]
      };
    });

    // Coba gemini-2.0-flash dulu, fallback ke gemini-pro
    const models = [
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-pro'
    ];

    let lastError = null;

    for (const modelName of models) {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: geminiContents,
            generationConfig: {
              maxOutputTokens: 1000,
              temperature: 0.7,
            }
          })
        }
      );

      const geminiData = await geminiRes.json();

      // Kalau tidak ada error, kembalikan hasilnya
      if (!geminiData.error) {
        const replyText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, tidak ada respons.';
        return res.status(200).json({
          content: [{ type: 'text', text: replyText }]
        });
      }

      // Simpan error, coba model berikutnya
      lastError = geminiData.error;
    }

    // Semua model gagal
    return res.status(400).json({
      error: 'Semua model gagal. Error terakhir: ' + (lastError?.message || JSON.stringify(lastError))
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};
