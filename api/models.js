module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key tidak ada' });

  const listRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  const data = await listRes.json();

  // Filter yang support generateContent saja
  const models = (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name);

  return res.status(200).json({ available_models: models, total: models.length });
};
