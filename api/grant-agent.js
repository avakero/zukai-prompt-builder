// POST /api/grant-agent   (旧 /api/grant-god)
// 入力 : Authorization: Bearer <LIFF ID/access token>
//        body (JSON) : { code: "<合言葉>" }
// 動作 : 合言葉 (環境変数 AGENT_GRANT_CODE) が一致したら、ログイン中の LINE ユーザーに
//        user_tags へ 'agent' タグを付与する (冪等: 既にあれば何もしない)。
//        app.js 側は TAG_FEATURE_GRANTS.agent で pro-agent (mode.agentBatch) を解放する。
// 出力 : 200 { ok:true, granted:true }
//        400 { error:'invalid_body' }      … code が空
//        401 { error:'invalid_token'|... } … LINE トークン検証失敗
//        403 { error:'wrong_code' }        … 合言葉不一致
//        405 { error:'method_not_allowed' }
//        500 { error:'internal_error'|'db_error' }
//        503 { error:'not_configured' }    … AGENT_GRANT_CODE / GOD_GRANT_CODE 未設定
//
// 設計メモ:
//   - plan='agent' に更新する案は entitlements.plan の CHECK 制約に 'agent' が無く
//     マイグレーション必須＋既存プランを上書きするため不採用。タグは加算式で安全。
//   - 合言葉照合は length ガード付き timingSafeEqual でタイミング攻撃を避ける。
//   - 改名前に付与済みのユーザーは user_tags に 'god' を持ったままだが、app.js の
//     TAG_FEATURE_GRANTS に旧タグの互換エントリを残してあるので解放は切れない。
//   - 環境変数も AGENT_GRANT_CODE を優先しつつ、Vercel 側の移行が済むまで
//     旧 GOD_GRANT_CODE をフォールバックとして読む。

const crypto = require('crypto');
const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { applyCors, handlePreflight } = require('./_lib/cors');
const { readJsonBody } = require('./_lib/request');

const ALLOW_METHODS = 'POST, OPTIONS';
const AGENT_TAG = 'agent';

// 長さガード付きの定数時間比較。長さが違えば即 false (長さ差はタイミングで漏れてよい)。
function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res, ALLOW_METHODS)) return;
  applyCors(req, res, ALLOW_METHODS);

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', ALLOW_METHODS);
    return res.json({ error: 'method_not_allowed' });
  }

  // AGENT_GRANT_CODE を優先。未設定なら旧 GOD_GRANT_CODE にフォールバックする。
  const expected = process.env.AGENT_GRANT_CODE || process.env.GOD_GRANT_CODE;
  if (!expected || !expected.trim()) {
    console.error('[api/grant-agent] AGENT_GRANT_CODE not configured');
    res.statusCode = 503;
    return res.json({ error: 'not_configured' });
  }

  // 認証 (LINE ログイン必須)
  let auth;
  try {
    auth = await authenticateFromAuthorizationHeader(req.headers.authorization);
  } catch (e) {
    if (e instanceof VerificationError) {
      console.warn('[api/grant-agent] auth failed', { code: e.code });
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/grant-agent] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // 合言葉チェック
  const body = await readJsonBody(req);
  const code = body && typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_body' });
  }
  if (!safeEqual(code, expected.trim())) {
    console.warn('[api/grant-agent] wrong code attempt');
    res.statusCode = 403;
    return res.json({ error: 'wrong_code' });
  }

  // 'agent' タグ付与 (冪等)
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[api/grant-agent] supabase init failed:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  const { error } = await supabase
    .from('user_tags')
    .upsert(
      { line_user_id: auth.lineUserId, tag: AGENT_TAG },
      { onConflict: 'line_user_id,tag', ignoreDuplicates: true }
    );
  if (error) {
    console.error('[api/grant-agent] db error:', error.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }

  console.log('[api/grant-agent] agent tag granted');
  res.statusCode = 200;
  return res.json({ ok: true, granted: true });
};
