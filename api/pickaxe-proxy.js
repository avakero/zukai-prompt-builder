// POST /api/pickaxe-proxy
// 入力 : Authorization: Bearer <LIFF access token>
//        body: { prompt, model, aspectRatio?, imageUrls?, apiKey }
// 出力 : 200 { imageUrl }
//        400 { error: 'invalid_input' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        502 { error: 'upstream_error' | 'no_image_in_response', status?, detail? }
//        504 { error: 'upstream_timeout' }
//
// 動作:
//   - Pickaxe API (https://api.pickaxe.co/v1/completions) は現在ブラウザ
//     からの直接呼び出しを CORS 拒否するため、サーバー経由でプロキシする。
//   - LIFF アクセストークンで認証し、不特定多数の悪用を防ぐ。
//   - レスポンスから画像 URL を抽出して返す (extractor は app.js と同等)。

const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { applyCors, handlePreflight } = require('./_lib/cors');

const ALLOW_METHODS = 'POST, OPTIONS';
const PICKAXE_ENDPOINT = 'https://api.pickaxe.co/v1/completions';
const MODEL_INPUT_ID = '57fac2d1-e94a-46b8-8afb-fff18fed82a3';
const PROMPT_INPUT_ID = '18fc7bff-e8e7-4660-9434-0cee04a658fd';
// Vercel Pro プランで maxDuration を 180s に設定している前提。
// プラットフォーム側の強制終了より少し早く AbortError を返したいので
// 170s をタイムアウトとする (Pickaxe の応答が 90-150s 程度かかるケースに対応)。
const REQUEST_TIMEOUT_MS = 170_000;

const IMAGE_URL_PATTERN = /https?:\/\/[^\s'"<>)\]]+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s'"<>)\]]*)*/gi;

function extractImageUrls(data) {
  const urls = [];
  function scan(obj) {
    if (typeof obj === 'string') {
      const m = obj.match(IMAGE_URL_PATTERN);
      if (m) urls.push(...m);
    } else if (Array.isArray(obj)) obj.forEach(scan);
    else if (obj && typeof obj === 'object') Object.values(obj).forEach(scan);
  }
  scan(data);
  return Array.from(new Set(urls));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', chunk => { buf += chunk; });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res, ALLOW_METHODS)) return;
  applyCors(req, res, ALLOW_METHODS);

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', ALLOW_METHODS);
    return res.json({ error: 'method_not_allowed' });
  }

  // 認証
  try {
    await authenticateFromAuthorizationHeader(req.headers.authorization);
  } catch (e) {
    if (e instanceof VerificationError) {
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/pickaxe-proxy] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // 入力検証
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input' });
  }
  const { prompt, model, aspectRatio, imageUrls, apiKey } = body;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input', detail: 'prompt required' });
  }
  if (typeof model !== 'string' || !model.trim()) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input', detail: 'model required' });
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input', detail: 'apiKey required' });
  }

  const fullPrompt = aspectRatio
    ? prompt + '\n\nアスペクト比: ' + aspectRatio
    : prompt;

  const payload = {
    inputs: {
      [MODEL_INPUT_ID]: model,
      [PROMPT_INPUT_ID]: fullPrompt
    },
    stream: false
  };
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    payload.imageUrls = imageUrls;
  }

  // Pickaxe へ転送
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let pickaxeRes;
  try {
    pickaxeRes = await fetch(PICKAXE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err && err.name === 'AbortError') {
      res.statusCode = 504;
      return res.json({ error: 'upstream_timeout' });
    }
    console.error('[api/pickaxe-proxy] fetch failed:', err.message);
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', detail: err.message });
  }
  clearTimeout(timeoutId);

  if (!pickaxeRes.ok) {
    const text = await pickaxeRes.text();
    console.warn('[api/pickaxe-proxy] upstream non-2xx:', pickaxeRes.status, text.substring(0, 200));
    res.statusCode = 502;
    return res.json({
      error: 'upstream_error',
      status: pickaxeRes.status,
      detail: text.substring(0, 500)
    });
  }

  let data;
  try {
    data = await pickaxeRes.json();
  } catch (err) {
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', detail: 'invalid JSON from Pickaxe' });
  }

  const urls = extractImageUrls(data);
  if (urls.length === 0) {
    console.warn('[api/pickaxe-proxy] no image URL in response');
    res.statusCode = 502;
    return res.json({ error: 'no_image_in_response' });
  }

  res.statusCode = 200;
  return res.json({ imageUrl: urls[0] });
};
