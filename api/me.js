// GET /api/me?product=<product_code>
// 入力 : Authorization: Bearer <LIFF access token>
//        query.product = 製品コード (例: zukai-builder)
//                        未指定なら環境変数 DEFAULT_PRODUCT_CODE にフォールバック
// 出力 : 200 { lineUserId, product, entitlement:{plan,status,planExpiresAt,updatedAt}, tags }
//        400 { error: 'missing_product' }
//        404 { error: 'unknown_product' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        502 { error: 'upstream_error' | 'upstream_timeout' }
//        500 { error: 'internal_error' }
//
// 副作用 :
//   - (line_user_id, product_code) が entitlements に無ければ plan='free' で upsert する
//     → ログインしたユーザーが製品ごとに自動的に蓄積され、運用者は UPDATE で昇格できる
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

function resolveProductCode(req) {
  const raw = (req.query && req.query.product) || null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const fallback = process.env.DEFAULT_PRODUCT_CODE;
  return fallback && fallback.trim() ? fallback.trim() : null;
}

async function productExists(supabase, productCode) {
  const { data, error } = await supabase
    .from('products')
    .select('code')
    .eq('code', productCode)
    .maybeSingle();
  if (error) throw new Error(`products select failed: ${error.message}`);
  return !!data;
}

async function loadUserProfile(supabase, lineUserId, productCode) {
  const { error: upsertErr } = await supabase
    .from('entitlements')
    .upsert(
      { line_user_id: lineUserId, product_code: productCode, plan: 'free', status: 'active' },
      { onConflict: 'line_user_id,product_code', ignoreDuplicates: true }
    );
  if (upsertErr) {
    throw new Error(`entitlements upsert failed: ${upsertErr.message}`);
  }

  const [{ data: ent, error: entErr }, { data: tagRows, error: tagErr }] = await Promise.all([
    supabase
      .from('entitlements')
      .select('plan, status, expires_at, updated_at')
      .eq('line_user_id', lineUserId)
      .eq('product_code', productCode)
      .maybeSingle(),
    supabase
      .from('user_tags')
      .select('tag')
      .eq('line_user_id', lineUserId)
  ]);

  if (entErr) throw new Error(`entitlements select failed: ${entErr.message}`);
  if (tagErr) throw new Error(`user_tags select failed: ${tagErr.message}`);

  return {
    plan:          ent && ent.plan ? ent.plan : 'free',
    status:        ent && ent.status ? ent.status : 'active',
    planExpiresAt: ent && ent.expires_at ? ent.expires_at : null,
    updatedAt:     ent && ent.updated_at ? ent.updated_at : null,
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

  const productCode = resolveProductCode(req);
  if (!productCode) {
    res.statusCode = 400;
    return res.json({ error: 'missing_product' });
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
    if (!(await productExists(supabase, productCode))) {
      console.warn('[api/me] unknown_product', { productCode });
      res.statusCode = 404;
      return res.json({ error: 'unknown_product' });
    }

    const profile = await loadUserProfile(supabase, auth.lineUserId, productCode);

    recordAudit(supabase, {
      line_user_id: auth.lineUserId,
      event:        'me_called',
      client_id:    auth.clientId,
      ip:           clientIp(req),
      user_agent:   req.headers['user-agent'] || null,
      detail:       { product: productCode }
    });

    res.statusCode = 200;
    return res.json({
      lineUserId: auth.lineUserId,
      product:    productCode,
      entitlement: {
        plan:          profile.plan,
        status:        profile.status,
        planExpiresAt: profile.planExpiresAt,
        updatedAt:     profile.updatedAt
      },
      tags: profile.tags
    });
  } catch (e) {
    console.error('[api/me] db error:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }
};
