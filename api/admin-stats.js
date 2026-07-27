// GET /api/admin-stats   (管理者専用: /admin ダッシュボードのデータソース)
// 入力 : Authorization: Bearer <LIFF ID/access token>
// 動作 : LINE トークンを検証し、ADMIN_LINE_USER_IDS (カンマ区切り) に含まれる
//        ユーザーのみ Supabase RPC admin_dashboard_stats() の集計 JSON を返す。
// 出力 : 200 { ok:true, stats:{...} }
//        401 { error:'invalid_token'|'expired_token'|... } … LINE トークン検証失敗
//        403 { error:'forbidden', lineUserId }  … 管理者リスト外 (自分の ID を確認できる)
//        405 { error:'method_not_allowed' }
//        500 { error:'internal_error'|'db_error'|'rpc_missing' }
//        503 { error:'not_configured' }         … ADMIN_LINE_USER_IDS 未設定
//
// 設計メモ:
//   - 未設定 (503) で閉じるオプトイン方式。grant-agent と同じ思想。
//   - 403 応答に本人の lineUserId を含める: 管理者本人が最初にアクセスした際、
//     この値をそのまま Vercel の ADMIN_LINE_USER_IDS に貼れるようにするため。
//     (ID 単体は秘密情報ではなく、これだけでは何も操作できない)
//   - 集計は全て DB 側 (0008 の RPC)。supabase-js の 1000 行上限を踏まない。
//   - 監査: 成功/拒否を auth_audit_log に記録 (失敗しても応答には影響させない)。

const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { applyCors, handlePreflight } = require('./_lib/cors');

const ALLOW_METHODS = 'GET, OPTIONS';

function getAdminIds() {
  const raw = process.env.ADMIN_LINE_USER_IDS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function clientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.length > 0) {
    return xfwd.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null;
}

async function recordAudit(supabase, row) {
  try {
    await supabase.from('auth_audit_log').insert(row);
  } catch (e) {
    console.warn('[api/admin-stats] audit log insert failed:', e && e.message);
  }
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res, ALLOW_METHODS)) return;
  applyCors(req, res, ALLOW_METHODS);

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', ALLOW_METHODS);
    return res.json({ error: 'method_not_allowed' });
  }

  const admins = getAdminIds();
  if (admins.length === 0) {
    console.error('[api/admin-stats] ADMIN_LINE_USER_IDS not configured');
    res.statusCode = 503;
    return res.json({ error: 'not_configured' });
  }

  // 認証 (LINE ログイン必須)
  let auth;
  try {
    auth = await authenticateFromAuthorizationHeader(req.headers.authorization);
  } catch (e) {
    if (e instanceof VerificationError) {
      console.warn('[api/admin-stats] auth failed', { code: e.code });
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/admin-stats] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[api/admin-stats] supabase init failed:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // 認可 (管理者リスト照合)
  if (!admins.includes(auth.lineUserId)) {
    console.warn('[api/admin-stats] forbidden', { suffix: auth.lineUserId.slice(-6) });
    recordAudit(supabase, {
      line_user_id: auth.lineUserId,
      event:        'admin_stats_forbidden',
      client_id:    auth.clientId,
      ip:           clientIp(req),
      user_agent:   req.headers['user-agent'] || null,
      detail:       null
    });
    res.statusCode = 403;
    // 本人の ID を返す: 管理者が自分の ID を ADMIN_LINE_USER_IDS へ貼るための導線
    return res.json({ error: 'forbidden', lineUserId: auth.lineUserId });
  }

  // 集計 RPC (supabase/migrations/0008_admin_dashboard_stats.sql)
  const { data, error } = await supabase.rpc('admin_dashboard_stats');
  if (error) {
    const missing = error.code === 'PGRST202'
      || /admin_dashboard_stats/.test(error.message || '') && /could not find|does not exist/i.test(error.message || '');
    if (missing) {
      console.error('[api/admin-stats] RPC missing — run migration 0008:', error.message);
      res.statusCode = 500;
      return res.json({ error: 'rpc_missing' });
    }
    console.error('[api/admin-stats] rpc error:', error.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }

  recordAudit(supabase, {
    line_user_id: auth.lineUserId,
    event:        'admin_stats_called',
    client_id:    auth.clientId,
    ip:           clientIp(req),
    user_agent:   req.headers['user-agent'] || null,
    detail:       null
  });

  res.statusCode = 200;
  return res.json({ ok: true, stats: data });
};
