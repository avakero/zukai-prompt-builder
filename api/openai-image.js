// POST /api/openai-image
// 入力 : Authorization: Bearer <LIFF access token>
//        body (JSON):
//          {
//            prompt:       string,                                            // 必須
//            model?:       'gpt-image-2' | 'gpt-image-1' | 'dall-e-3',        // デフォルト gpt-image-2
//            aspectRatio?: '1:1' | '4:5' | '5:4' | '16:9' | '9:16',
//            imageUrls?:   string[],                  // 画像入力 (gpt-image-2 / gpt-image-1)
//            quality?:     'low' | 'medium' | 'high' | 'auto'
//          }
// 出力 : 200 { imageUrl, model, elapsedMs }   // imageUrl は data:image/png;base64,... 形式
//        400 { error: 'invalid_input' | 'unsupported_model' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        500 { error: 'key_not_configured' | 'internal_error' }
//        502 { error: 'upstream_error', status?, detail? }
//        504 { error: 'upstream_timeout' }
//
// 設計:
//   - OPENAI_API_KEY env var からキーを取得 (ブラウザには絶対に渡さない)
//   - 返ってきた base64 画像は Supabase Storage 'generated-images' バケットに
//     アップロードして公開 URL を応答に乗せる (data URL 直返しは応答が重く、
//     共有・再訪 UX も組めないため)。
//   - Storage アップロードに失敗した場合のみ data URL にフォールバックする
//     (best-effort)。
//   - imageUrls が指定された場合は /v1/images/edits を使う (image-to-image)。
//     Pickaxe の character refs と同じ役割。
//
// スパイク用 curl (アプリを経由せず直接 OpenAI API を叩く参考):
//   curl https://api.openai.com/v1/images/generations \
//     -H "Authorization: Bearer $OPENAI_API_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{
//       "model": "gpt-image-2",
//       "prompt": "...",
//       "n": 1,
//       "size": "1024x1024",
//       "quality": "medium"
//     }'
//
// gpt-image-2 メモ:
//   - レート制限 (Tier 1): 5 IPM (=images per minute)。7並列同時発火は通る想定
//     だが、無料/低位アカウントだと 429 を踏む可能性。Tier 2 (20 IPM) 以上を推奨。
//   - size は 1024x1024 / 1024x1536 / 1536x1024 / 2048x2048 / 2048x1152 / auto など
//     多様に対応。最大3840px。本実装は 1024 系のみ使用 (コスト最適化のため)。
//   - quality: low / medium / high / auto。デフォルト medium。
//   - input_fidelity は gpt-image-2 では設定不可 (API がいまのところ受け付けない)。
//   - 画像入力は /v1/images/edits (gpt-image-1 と同じ)。

const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { applyCors, handlePreflight } = require('./_lib/cors');
const { uploadGeneratedImage } = require('./_lib/image-storage');

const ALLOW_METHODS = 'POST, OPTIONS';
const GENERATIONS_ENDPOINT = 'https://api.openai.com/v1/images/generations';
const EDITS_ENDPOINT       = 'https://api.openai.com/v1/images/edits';
// OpenAI は通常 5-30s と言われるが、gpt-image-2 + /v1/images/edits (画像入力) は
// 1分超かかるケースを観測したため、Vercel maxDuration=180s の内側で 170s abort とする。
// 実測でこれ以下に短縮できるようなら下げる。
const REQUEST_TIMEOUT_MS   = 170_000;

// 対応モデル。gpt-image-2 は 2026年4月に公開された最新世代。
const SUPPORTED_MODELS = ['gpt-image-2', 'gpt-image-1', 'dall-e-3'];
const DEFAULT_MODEL = 'gpt-image-2';
// 画像入力 (img2img / character refs) をサポートするモデル
const IMG2IMG_MODELS = new Set(['gpt-image-2', 'gpt-image-1']);

// aspectRatio → size マッピング。
// gpt-image-2 / gpt-image-1 共通で 1024x1024 / 1024x1536 / 1536x1024 をサポート。
// (gpt-image-2 は他に 2048x* / 3840x2160 も使えるが、コストと応答時間を抑えるため
//  1024 系のみ使用。必要なら将来 size パラメータを明示できるよう body で受ける形に拡張する)
function aspectToSize(ar) {
  switch (ar) {
    case '1:1':  return '1024x1024';
    case '4:5':
    case '3:4':
    case '9:16': return '1024x1536';
    case '5:4':
    case '4:3':
    case '16:9': return '1536x1024';
    default:     return '1024x1024';
  }
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

// imageUrls (公開URL) を fetch して Buffer 化、multipart/form-data の File として送る準備
async function downloadImageBuffer(url) {
  const res = await fetchWithTimeout(url, {}, 15_000);
  if (!res.ok) throw new Error(`fetch ref image failed: ${res.status}`);
  const arr = await res.arrayBuffer();
  const ct = res.headers.get('content-type') || 'image/png';
  return { buf: Buffer.from(arr), contentType: ct };
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
    console.error('[api/openai-image] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // API キー
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error('[api/openai-image] OPENAI_API_KEY env var missing');
    res.statusCode = 500;
    return res.json({ error: 'key_not_configured' });
  }

  // 入力検証
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

  const model = (typeof body.model === 'string' && body.model.trim()) || DEFAULT_MODEL;
  if (!SUPPORTED_MODELS.includes(model)) {
    res.statusCode = 400;
    return res.json({ error: 'unsupported_model' });
  }

  const size = aspectToSize(body.aspectRatio);
  const quality = (typeof body.quality === 'string' && body.quality.trim()) || 'medium';
  const refImageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u)) : [];

  const t0 = Date.now();

  try {
    let upstreamRes;

    if (refImageUrls.length > 0 && IMG2IMG_MODELS.has(model)) {
      // 画像入力モード: /v1/images/edits を multipart/form-data で叩く
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', size);
      form.append('quality', quality);

      for (let i = 0; i < Math.min(refImageUrls.length, 4); i++) {
        const { buf, contentType } = await downloadImageBuffer(refImageUrls[i]);
        const blob = new Blob([buf], { type: contentType });
        form.append('image[]', blob, `ref${i}.png`);
      }

      upstreamRes = await fetchWithTimeout(EDITS_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form
      }, REQUEST_TIMEOUT_MS);
    } else {
      // 通常のテキスト→画像モード
      const payload = {
        model,
        prompt,
        n: 1,
        size
      };
      // dall-e-3 は quality を "standard" / "hd" で受けるので gpt-image-* のみ送る
      if (model === 'gpt-image-2' || model === 'gpt-image-1') {
        payload.quality = quality;
      }

      upstreamRes = await fetchWithTimeout(GENERATIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }, REQUEST_TIMEOUT_MS);
    }

    const elapsedMs = Date.now() - t0;

    if (!upstreamRes.ok) {
      let detail = '';
      try { detail = (await upstreamRes.text()).slice(0, 500); } catch (_) {}
      console.warn('[api/openai-image] upstream non-2xx', { status: upstreamRes.status, detail, elapsedMs });
      res.statusCode = 502;
      return res.json({ error: 'upstream_error', status: upstreamRes.status, detail });
    }

    const data = await upstreamRes.json();
    const first = data && Array.isArray(data.data) ? data.data[0] : null;
    if (!first) {
      res.statusCode = 502;
      return res.json({ error: 'upstream_error', detail: 'no data field in response' });
    }

    let imageUrl = null;
    let storagePath = null;
    if (first.b64_json) {
      // Supabase Storage に上げて公開URLを得る。失敗時のみ data URL にフォールバック。
      try {
        const uploaded = await uploadGeneratedImage(first.b64_json, 'image/png', auth.lineUserId);
        imageUrl = uploaded.publicUrl;
        storagePath = uploaded.path;
      } catch (uploadErr) {
        console.warn('[api/openai-image] storage upload failed, falling back to data URL:', uploadErr && uploadErr.message);
        imageUrl = `data:image/png;base64,${first.b64_json}`;
      }
    } else if (first.url) {
      // dall-e-3 は url を直接返す (OpenAI CDN; 一定時間で失効する点に注意)
      imageUrl = first.url;
    }
    if (!imageUrl) {
      res.statusCode = 502;
      return res.json({ error: 'upstream_error', detail: 'response had neither b64_json nor url' });
    }

    console.log('[api/openai-image] success', {
      model, elapsedMs,
      hasRefs: refImageUrls.length > 0,
      storage: storagePath ? 'uploaded' : 'data-url-fallback'
    });
    res.statusCode = 200;
    return res.json({ imageUrl, model, elapsedMs });

  } catch (e) {
    const elapsedMs = Date.now() - t0;
    if (e && e.name === 'AbortError') {
      console.warn('[api/openai-image] timeout', { elapsedMs });
      res.statusCode = 504;
      return res.json({ error: 'upstream_timeout' });
    }
    console.error('[api/openai-image] unexpected error:', e && e.message);
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', detail: (e && e.message ? e.message : 'unknown').slice(0, 500) });
  }
};
