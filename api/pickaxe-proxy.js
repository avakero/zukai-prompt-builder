// POST /api/pickaxe-proxy
// 入力 : Authorization: Bearer <LIFF access token>
//        body: { prompt, keyIndex, aspectRatio?, imageUrls? }
//          - keyIndex: 0〜6 (どのワークスペースのデプロイメントキーを使うか)
//          - prompt: 画像生成プロンプト
//          - imageUrls: 参考画像 (オプション)
// 出力 : 200 { imageUrl, keyIndex, elapsedMs }
//        400 { error: 'invalid_input' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        500 { error: 'key_not_configured' }      <- 指定 index の env var 未設定
//        502 { error: 'upstream_error', status?, detail? }
//        504 { error: 'upstream_timeout' }
//
// 設計:
//   - Pickaxe のワークスペース 7 つにそれぞれ別の画像生成 Pickaxe を作り、
//     各ワークスペースのデプロイメントキーを Vercel 環境変数に保存する。
//     キーは PICKAXE_API_KEY_1 〜 PICKAXE_API_KEY_7 を読みに行く。
//   - 別ワークスペース = 別 Modal リソース、なので真の並列が可能。
//   - リクエストごとに client 側で keyIndex (0..6) を割り当て、サーバ側で
//     対応する env var からキーを引いて Pickaxe に投げる。
//   - 新しいワークスペースは form-chat 型なので、入力は `inputs.{uuid}` 形式
//     ではなく `message` トップレベル形式。imageUrls もトップレベル。

const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { applyCors, handlePreflight } = require('./_lib/cors');

const ALLOW_METHODS = 'POST, OPTIONS';
const PICKAXE_ENDPOINT = 'https://api.pickaxe.co/v1/completions';
const KEY_COUNT = 7;

// Pickaxe の form-chat デプロイメントは inputs.{uuid} 形式で入力を受け取る。
// 7 つの新ワークスペースは同じテンプレート由来で UUID が共通 (Pickaxe の API
// 画面で全て同じだったことを確認済み)。違うワークスペースが出てきた場合は
// PICKAXE_MODEL_INPUT_ID_{N} / PICKAXE_PROMPT_INPUT_ID_{N} の env で上書き可。
const DEFAULT_MODEL_INPUT_ID  = '57fac2d1-e94a-46b8-8afb-fff18fed82a3';
const DEFAULT_PROMPT_INPUT_ID = '18fc7bff-e8e7-4660-9434-0cee04a658fd';

function getInputIdsForIndex(idx) {
  const n = idx + 1;
  const modelId = process.env[`PICKAXE_MODEL_INPUT_ID_${n}`];
  const promptId = process.env[`PICKAXE_PROMPT_INPUT_ID_${n}`];
  return {
    modelInputId:  (modelId && modelId.trim())  || DEFAULT_MODEL_INPUT_ID,
    promptInputId: (promptId && promptId.trim()) || DEFAULT_PROMPT_INPUT_ID
  };
}

// Vercel Pro プランで maxDuration を 250s に設定している前提。
// プラットフォーム側の強制終了より少し早く AbortError を返したいので
// 240s をタイムアウトとする (Pickaxe 混雑時は 120-200s 程度かかることが
// 実測されており、170s では不足だった)。
const REQUEST_TIMEOUT_MS = 240_000;

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

function getApiKeyForIndex(idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= KEY_COUNT) return null;
  // PICKAXE_API_KEY_1 〜 PICKAXE_API_KEY_7 (1-origin)
  const envName = `PICKAXE_API_KEY_${idx + 1}`;
  const v = process.env[envName];
  return v && typeof v === 'string' && v.trim() ? v.trim() : null;
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
  let auth;
  try {
    auth = await authenticateFromAuthorizationHeader(req.headers.authorization);
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
  const { prompt, model, keyIndex, aspectRatio, imageUrls } = body;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input', detail: 'prompt required' });
  }
  if (typeof model !== 'string' || !model.trim()) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input', detail: 'model required' });
  }
  if (!Number.isInteger(keyIndex)) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input', detail: 'keyIndex (integer 0..6) required' });
  }

  const apiKey = getApiKeyForIndex(keyIndex);
  if (!apiKey) {
    console.error(`[api/pickaxe-proxy] key not configured for index ${keyIndex} (env PICKAXE_API_KEY_${keyIndex + 1})`);
    res.statusCode = 500;
    return res.json({ error: 'key_not_configured', keyIndex });
  }

  const fullPrompt = aspectRatio
    ? prompt + '\n\nアスペクト比: ' + aspectRatio
    : prompt;

  // Pickaxe デプロイメントの inputs.{uuid} 形式
  // (Pickaxe API ページの Python サンプルと同形)
  const { modelInputId, promptInputId } = getInputIdsForIndex(keyIndex);
  const payload = {
    inputs: {
      [modelInputId]:  model,
      [promptInputId]: fullPrompt
    },
    stream: false
  };
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    payload.imageUrls = imageUrls;
  }

  // Pickaxe へ転送
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

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
    const elapsedMs = Date.now() - startedAt;
    if (err && err.name === 'AbortError') {
      console.warn(`[api/pickaxe-proxy] timeout idx=${keyIndex} after ${elapsedMs}ms`);
      res.statusCode = 504;
      return res.json({ error: 'upstream_timeout', keyIndex, elapsedMs });
    }
    console.error(`[api/pickaxe-proxy] fetch failed idx=${keyIndex}: ${err.message}`);
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', detail: err.message, keyIndex });
  }
  clearTimeout(timeoutId);
  const elapsedMs = Date.now() - startedAt;

  if (!pickaxeRes.ok) {
    const text = await pickaxeRes.text();
    console.warn(`[api/pickaxe-proxy] upstream non-2xx idx=${keyIndex} status=${pickaxeRes.status} elapsed=${elapsedMs}ms body=${text.substring(0, 200)}`);
    res.statusCode = 502;
    return res.json({
      error: 'upstream_error',
      status: pickaxeRes.status,
      detail: text.substring(0, 500),
      keyIndex,
      elapsedMs
    });
  }

  let data;
  try {
    data = await pickaxeRes.json();
  } catch (err) {
    console.warn(`[api/pickaxe-proxy] invalid JSON idx=${keyIndex} elapsed=${elapsedMs}ms`);
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', detail: 'invalid JSON from Pickaxe', keyIndex, elapsedMs });
  }

  // Pickaxe は HTTP 200 でも body に `{ success: false, error: "..." }` を
  // 返してくることがある (デプロイ設定不備・モデル制限・入力エラーなど)。
  // 画像 URL 抽出より先にここで握って、生のエラー本文をフロントへ転送する。
  if (data && data.success === false) {
    const pickaxeError = typeof data.error === 'string' ? data.error : JSON.stringify(data.error || {}).substring(0, 500);
    console.warn(`[api/pickaxe-proxy] pickaxe returned success=false idx=${keyIndex} elapsed=${elapsedMs}ms error=${pickaxeError}`);
    res.statusCode = 502;
    return res.json({
      error: 'pickaxe_error',
      pickaxeError,
      keyIndex,
      elapsedMs,
      // 失敗詳細 (errorCode, details, requestId など) もそのまま見せる
      raw: data
    });
  }

  const urls = extractImageUrls(data);
  if (urls.length === 0) {
    // 応答に画像URLが見つからなかった場合、何が返ってきているか診断する
    // ため応答全体の先頭部分をログに出す。
    let snippet;
    try {
      snippet = JSON.stringify(data).substring(0, 1500);
    } catch {
      snippet = String(data).substring(0, 1500);
    }
    console.warn(
      `[api/pickaxe-proxy] no image URL in response idx=${keyIndex} elapsed=${elapsedMs}ms` +
      ` keys=[${data && typeof data === 'object' ? Object.keys(data).join(',') : ''}]\n` +
      `--- response snippet ---\n${snippet}\n--- end snippet ---`
    );
    res.statusCode = 502;
    return res.json({
      error: 'no_image_in_response',
      keyIndex,
      elapsedMs,
      responseKeys: data && typeof data === 'object' ? Object.keys(data) : null,
      responseSnippet: snippet.substring(0, 400)
    });
  }

  console.log(`[api/pickaxe-proxy] success idx=${keyIndex} elapsed=${elapsedMs}ms imageUrl=${urls[0].substring(0, 80)}`);
  res.statusCode = 200;
  return res.json({ imageUrl: urls[0], keyIndex, elapsedMs });
};
