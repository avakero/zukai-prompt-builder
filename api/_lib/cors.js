// CORS ヘッダを ALLOWED_ORIGINS (カンマ区切り) のホワイトリストで付与する。
// 同一オリジン配信なら ALLOWED_ORIGINS 未設定でも問題ない。

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  const allowed = getAllowedOrigins();
  return allowed.includes(origin);
}

function applyCors(req, res, methods = 'GET, OPTIONS') {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-OpenAI-Key, X-Gemini-Key, X-Temporary-Pro-Max-Access');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

// preflight (OPTIONS) を処理した場合 true を返す。呼び出し側はその場合 return すること。
function handlePreflight(req, res, methods = 'GET, OPTIONS') {
  if (req.method !== 'OPTIONS') return false;
  applyCors(req, res, methods);
  res.statusCode = 204;
  res.end();
  return true;
}

module.exports = { applyCors, handlePreflight, isOriginAllowed };
