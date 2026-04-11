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
      return res.status(400).json({ error: 'Invalid request' });
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

    // Cek model yang tersedia dulu
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    const listData = await listRes.json();

    if (listData.error) {
      return res.status(400).json({ error: 'Gagal ambil daftar model: ' + listData.error.message });
    }

    // Ambil model pertama yang support generateContent
    const availableModels = (listData.models || [])
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));

    if (availableModels.length === 0) {
      return res.status(400).json({ error: 'Tidak ada model Gemini yang tersedia di akun ini.', models: listData.models });
    }

    // Prioritaskan model flash/pro terbaru
    const preferred = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
    let selectedModel = availableModels[0];
    for (const p of preferred) {
      if (availableModels.find(m => m.includes(p.replace('gemini-', '')))) {
        selectedModel = availableModels.find(m => m.includes(p.replace('gemini-', '')));
        break;
      }
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 1000, temperature: 0.7 }
        })
      }
    );

    const geminiData = await geminiRes.json();

    if (geminiData.error) {
      return res.status(400).json({ error: geminiData.error.message, modelUsed: selectedModel });
    }

    const replyText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, tidak ada respons.';

    return res.status(200).json({
      content: [{ type: 'text', text: replyText }]
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};
