// POST /api/straico
// 入力 : Authorization: Bearer <LIFF access token>
//        body (JSON): { model: string, prompt: string }
// 出力 : 200 <Straico API のレスポンス JSON をそのまま透過>
//        400 { error: 'invalid_input' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        500 { error: 'key_not_configured' | 'internal_error' }
//        4xx/5xx { error: 'upstream_error', status, message }   // upstream のステータスを透過
//        504 { error: 'upstream_timeout' }
//
// 設計:
//   - 旧実装はブラウザ配信される app.js に内蔵 Straico キーを直書きしていた
//     (誰でも抽出可能 = キー漏洩) ため、キーを STRAICO_API_KEY env var に移し
//     このプロキシ経由に変更した。
//   - ユーザーが自分の Straico キーを設定している場合は従来どおりブラウザから
//     Straico を直接呼ぶ (このプロキシは通らない)。
//   - 成功時は Straico のレスポンス JSON をそのまま返す (フロントの抽出
//     フォールバックチェーンを直接呼び出しと共通化するため)。
//   - 失敗時は upstream の HTTP ステータスをそのまま返す。フロントは
//     「422 + 'model not found'」でフォールバックモデル再試行を判定するため、
//     message に upstream のエラーメッセージを載せる。

const { VerificationError } = require('./_lib/line');
const { authenticateWithTemporaryProMax } = require('./_lib/temp-access');
const { applyCors, handlePreflight } = require('./_lib/cors');
const { readJsonBody, MAX_PROMPT_CHARS } = require('./_lib/request');
const { userIsDeveloper } = require('./_lib/tags');

const ALLOW_METHODS = 'POST, OPTIONS';
const STRAICO_ENDPOINT = 'https://api.straico.com/v1/prompt/completion';
// テキスト生成は通常 10〜60s。Vercel maxDuration=120s の内側で 110s abort。
const REQUEST_TIMEOUT_MS = 110_000;

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
    auth = await authenticateWithTemporaryProMax(req);
  } catch (e) {
    if (e instanceof VerificationError) {
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/straico] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // Straico は開発者 (オーナー本人) 専用。内蔵キーを使うため、タグ保有者のみ許可。
  // 一般ユーザーは UI にも出ないが、直接叩かれても here で弾く (二重防御)。
  if (!(await userIsDeveloper(auth.lineUserId))) {
    console.warn('[api/straico] forbidden (not developer)', { lineUserId: auth.lineUserId });
    res.statusCode = 403;
    return res.json({ error: 'forbidden' });
  }

  const apiKey = process.env.STRAICO_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error('[api/straico] STRAICO_API_KEY env var missing');
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
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT_CHARS || !model || model.length > 100) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_input' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const t0 = Date.now();

  let upstreamRes;
  try {
    upstreamRes = await fetch(STRAICO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ models: [model], message: prompt }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err && err.name === 'AbortError') {
      console.warn('[api/straico] timeout', { elapsedMs: Date.now() - t0 });
      res.statusCode = 504;
      return res.json({ error: 'upstream_timeout' });
    }
    console.error('[api/straico] fetch failed:', err && err.message);
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', message: (err && err.message ? err.message : 'unknown').slice(0, 300) });
  }
  clearTimeout(timeoutId);
  const elapsedMs = Date.now() - t0;

  if (!upstreamRes.ok) {
    let message = '';
    try {
      const text = await upstreamRes.text();
      try {
        const parsed = JSON.parse(text);
        message = parsed.message || parsed.error || (parsed.error && parsed.error.message) || text;
      } catch {
        message = text;
      }
    } catch (_) {}
    message = String(message || '').slice(0, 300);
    console.warn('[api/straico] upstream non-2xx', { status: upstreamRes.status, message, elapsedMs });
    // フロントの modelNotFound 判定 (422 + 'model not found') のためステータスを透過
    // (範囲外の値は念のため 502 に丸める)
    res.statusCode = (upstreamRes.status >= 400 && upstreamRes.status < 600) ? upstreamRes.status : 502;
    return res.json({ error: 'upstream_error', status: upstreamRes.status, message });
  }

  let data;
  try {
    data = await upstreamRes.json();
  } catch {
    res.statusCode = 502;
    return res.json({ error: 'upstream_error', message: 'invalid JSON from Straico' });
  }

  console.log('[api/straico] success', { model, elapsedMs });
  res.statusCode = 200;
  return res.json(data);
};
