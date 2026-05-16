// GET /api/me
// 入力 : Authorization: Bearer <LIFF access token>
// 出力 : 200 { lineUserId, plan, status, planExpiresAt, tags, updatedAt }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        502 { error: 'upstream_error' | 'upstream_timeout' }
//        500 { error: 'internal_error' }
//
// 副作用 :
//   - 該当 line_user_id が subscriptions に無ければ plan='free' で upsert する
//     → ログインしたユーザーが自動的にテーブルに蓄積され、運用者は手動で UPDATE
//       するだけでプラン昇格できる。
//   - auth_audit_log に呼び出しを記録する (失敗しても応答には影響させない)

const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { applyCors, handlePreflight } = require('./_lib/cors');

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
    console.warn('[api/me] audit log insert failed:', e && e.message);
  }
}

async function loadUserProfile(supabase, lineUserId) {
  // upsert デフォルト free 行 (既存行があれば触らない)
  const { error: upsertErr } = await supabase
    .from('subscriptions')
    .upsert(
      { line_user_id: lineUserId, plan: 'free', status: 'active' },
      { onConflict: 'line_user_id', ignoreDuplicates: true }
    );
  if (upsertErr) {
    throw new Error(`subscriptions upsert failed: ${upsertErr.message}`);
  }

  const [{ data: sub, error: subErr }, { data: tagRows, error: tagErr }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status, expires_at, updated_at')
      .eq('line_user_id', lineUserId)
      .maybeSingle(),
    supabase
      .from('user_tags')
      .select('tag')
      .eq('line_user_id', lineUserId)
  ]);

  if (subErr) throw new Error(`subscriptions select failed: ${subErr.message}`);
  if (tagErr) throw new Error(`user_tags select failed: ${tagErr.message}`);

  return {
    plan:          sub && sub.plan ? sub.plan : 'free',
    status:        sub && sub.status ? sub.status : 'active',
    planExpiresAt: sub && sub.expires_at ? sub.expires_at : null,
    updatedAt:     sub && sub.updated_at ? sub.updated_at : null,
    tags:          Array.isArray(tagRows) ? tagRows.map(r => r.tag) : []
  };
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.json({ error: 'method_not_allowed' });
  }

  let auth;
  try {
    auth = await authenticateFromAuthorizationHeader(req.headers.authorization);
  } catch (e) {
    if (e instanceof VerificationError) {
      console.warn('[api/me] auth failed', { code: e.code, httpStatus: e.httpStatus });
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/me] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[api/me] supabase init failed:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  try {
    const profile = await loadUserProfile(supabase, auth.lineUserId);

    // 監査ログは fire-and-forget
    recordAudit(supabase, {
      line_user_id: auth.lineUserId,
      event:        'me_called',
      client_id:    auth.clientId,
      ip:           clientIp(req),
      user_agent:   req.headers['user-agent'] || null
    });

    res.statusCode = 200;
    return res.json({
      lineUserId:    auth.lineUserId,
      plan:          profile.plan,
      status:        profile.status,
      planExpiresAt: profile.planExpiresAt,
      tags:          profile.tags,
      updatedAt:     profile.updatedAt
    });
  } catch (e) {
    console.error('[api/me] db error:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }
};
