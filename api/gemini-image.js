// POST /api/gemini-image
// 入力 : Authorization: Bearer <LIFF access token>
//        body (JSON):
//          {
//            prompt:       string,                              // 必須
//            model?:       'imagen-3.0-generate-002'            // 純粋な text-to-image
//                        | 'gemini-2.5-flash-image-preview',    // multimodal、img2img 対応
//            aspectRatio?: '1:1' | '4:5' | '3:4' | '5:4' | '4:3' | '16:9' | '9:16',
//            imageUrls?:   string[]   // 画像入力 (gemini-2.5-flash-image-preview のみ対応)
//          }
// 出力 : 200 { imageUrl, model, elapsedMs }   // imageUrl は data:image/png;base64,... 形式
//        400 / 401 / 405 / 500 / 502 / 504 (openai-image と同じスキーマ)
//
// 設計:
//   - GEMINI_API_KEY env var からキーを取得 (Google AI Studio で発行したキー)
//   - Imagen 3 (純粋な text→image) と Gemini 2.5 Flash Image (multimodal) を切替可能
//   - レスポンスは base64 → data URL で返す。PHASE-B TODO は openai-image と同じ。
//
// スパイク用 curl:
//   # Imagen 3 (text→image):
//   curl "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=$GEMINI_API_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{
//       "instances":[{"prompt":"..."}],
//       "parameters":{"sampleCount":1,"aspectRatio":"1:1"}
//     }'
//
//   # Gemini 2.5 Flash Image (multimodal):
//   curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=$GEMINI_API_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{
//       "contents":[{"parts":[{"text":"..."}]}],
//       "generationConfig":{"responseModalities":["IMAGE"]}
//     }'

const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { applyCors, handlePreflight } = require('./_lib/cors');

const ALLOW_METHODS = 'POST, OPTIONS';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 55_000;

const IMAGEN_AR_SUPPORTED = new Set(['1:1', '9:16', '16:9', '3:4', '4:3']);

function normalizeAspectRatio(ar) {
  if (!ar) return '1:1';
  if (IMAGEN_AR_SUPPORTED.has(ar)) return ar;
  // 互換変換
  if (ar === '4:5') return '3:4';
  if (ar === '5:4') return '4:3';
  return '1:1';
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

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImageAsBase64(url) {
  const res = await fetchWithTimeout(url, {}, 15_000);
  if (!res.ok) throw new Error(`fetch ref image failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') || 'image/png';
  return { mimeType, b64: buf.toString('base64') };
}

async function callImagen3(apiKey, prompt, aspectRatio) {
  const url = `${API_BASE}/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio }
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 500); } catch (_) {}
    return { ok: false, status: res.status, detail };
  }

  const data = await res.json();
  const first = data && Array.isArray(data.predictions) ? data.predictions[0] : null;
  if (!first || !first.bytesBase64Encoded) {
    return { ok: false, status: 502, detail: 'no predictions in response' };
  }
  const mime = first.mimeType || 'image/png';
  return { ok: true, dataUrl: `data:${mime};base64,${first.bytesBase64Encoded}` };
}

async function callGemini25FlashImage(apiKey, prompt, refImageUrls) {
  const url = `${API_BASE}/gemini-2.5-flash-image-preview:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: prompt }];
  for (let i = 0; i < Math.min(refImageUrls.length, 4); i++) {
    const { mimeType, b64 } = await downloadImageAsBase64(refImageUrls[i]);
    parts.push({ inlineData: { mimeType, data: b64 } });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE'] }
  };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 500); } catch (_) {}
    return { ok: false, status: res.status, detail };
  }

  const data = await res.json();
  const cand = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const partsResp = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const imagePart = partsResp.find(p => p && p.inlineData && p.inlineData.data);
  if (!imagePart) {
    return { ok: false, status: 502, detail: 'no inlineData in response' };
  }
  const mime = imagePart.inlineData.mimeType || 'image/png';
  return { ok: true, dataUrl: `data:${mime};base64,${imagePart.inlineData.data}` };
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
  let auth;
  try {
    auth = await authenticateFromAuthorizationHeader(req.headers.authorization);
  } catch (e) {
    if (e instanceof VerificationError) {
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/gemini-image] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error('[api/gemini-image] GEMINI_API_KEY env var missing');
    res.statusCode = 500;
    return res.json({ error: 'key_not_configured' });
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input' });
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input' });
  }

  const model = (typeof body.model === 'string' && body.model.trim()) || 'imagen-3.0-generate-002';
  const SUPPORTED = ['imagen-3.0-generate-002', 'gemini-2.5-flash-image-preview'];
  if (!SUPPORTED.includes(model)) {
    res.statusCode = 400;
    return res.json({ error: 'unsupported_model' });
  }

  const aspectRatio = normalizeAspectRatio(body.aspectRatio);
  const refImageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u))
    : [];

  const t0 = Date.now();
  try {
    let result;
    if (model === 'imagen-3.0-generate-002') {
      // Imagen 3 は純粋な text-to-image。imageUrls は無視 (将来 Imagen edit が出たら対応)
      result = await callImagen3(apiKey.trim(), prompt, aspectRatio);
    } else {
      // gemini-2.5-flash-image-preview: multimodal、character refs を直接inlineで送れる
      result = await callGemini25FlashImage(apiKey.trim(), prompt, refImageUrls);
    }

    const elapsedMs = Date.now() - t0;

    if (!result.ok) {
      console.warn('[api/gemini-image] upstream non-2xx', { model, status: result.status, detail: result.detail, elapsedMs });
      res.statusCode = 502;
      return res.json({ error: 'upstream_error', status: result.status, detail: result.detail });
    }

    console.log('[api/gemini-image] success', { model, elapsedMs, hasRefs: refImageUrls.length > 0 });
    res.statusCode = 200;
    return res.json({ imageUrl: result.dataUrl, model, elapsedMs });

  } catch (e) {
    const elapsedMs = Date.now() - t0;
    if (e && e.name === 'AbortError') {
      console.warn('[api/gemini-image] timeout', { elapsedMs });
      res.statusCode = 504;
      return res.json({ error: 'upstream_timeout' });
    }
    console.error('[api/gemini-image] unexpected error:', e && e.message);
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', detail: (e && e.message ? e.message : 'unknown').slice(0, 500) });
  }
};
