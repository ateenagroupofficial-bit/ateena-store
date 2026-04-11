module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const geminiKey = process.env.GEMINI_API_KEY;
  return res.status(200).json({
    gemini_key_exists: !!geminiKey,
    gemini_key_prefix: geminiKey ? geminiKey.substring(0, 8) + '...' : 'TIDAK ADA',
    node_env: process.env.NODE_ENV || 'tidak diset'
  });
};
