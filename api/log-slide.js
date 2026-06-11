// POST /api/log-slide
// 入力 : Authorization: Bearer <LIFF access token>
//        body (JSON) :
//          {
//            job_id:        "uuid",
//            slide_idx:     int,
//            status:        'success' | 'failed' | 'running',
//            image_url?:    string,
//            error?:        string,
//            workspace_idx?:int,
//            elapsed_ms?:   int
//          }
// 出力 : 200 { ok: true }
//        400 { error: 'invalid_body' | 'invalid_job_id' | 'invalid_slide_idx' | 'invalid_status' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        403 { error: 'job_not_owned' }
//        404 { error: 'job_not_found' }
//        405 { error: 'method_not_allowed' }
//        500 { error: 'internal_error' | 'db_error' }
//
// 設計メモ:
//   - 1スライドの完了 (成功 or 失敗) ごとに fire-and-forget で呼ばれる想定。
//   - 認証ユーザーが job の所有者であることを確認してから更新する。
//   - 失敗してもクライアント側の UI 反映には影響させない (best-effort logging)。

const { VerificationError } = require('./_lib/line');
const { authenticateWithTemporaryProMax } = require('./_lib/temp-access');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { applyCors, handlePreflight } = require('./_lib/cors');
const { readJsonBody } = require('./_lib/request');

const ALLOW_METHODS = 'POST, OPTIONS';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_STATUS = new Set(['success', 'failed', 'running']);

function pickString(v, max = 4000) {
  if (typeof v !== 'string') return null;
  return v.length > max ? v.slice(0, max) : v;
}

function pickInt(v) {
  return Number.isInteger(v) ? v : null;
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
    auth = await authenticateWithTemporaryProMax(req);
  } catch (e) {
    if (e instanceof VerificationError) {
      console.warn('[api/log-slide] auth failed', { code: e.code });
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/log-slide] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // 入力検証
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    return res.json({ error: 'invalid_body' });
  }

  const jobId = pickString(body.job_id, 64);
  if (!jobId || !UUID_RE.test(jobId)) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_job_id' });
  }

  const slideIdx = pickInt(body.slide_idx);
  if (slideIdx === null || slideIdx < 0 || slideIdx > 50) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_slide_idx' });
  }

  const status = pickString(body.status, 32);
  if (!status || !ALLOWED_STATUS.has(status)) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_status' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[api/log-slide] supabase init failed:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // job の所有者確認
  const { data: jobRow, error: jobErr } = await supabase
    .from('generation_jobs')
    .select('id, line_user_id')
    .eq('id', jobId)
    .maybeSingle();

  if (jobErr) {
    console.error('[api/log-slide] generation_jobs select failed:', jobErr.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }
  if (!jobRow) {
    res.statusCode = 404;
    return res.json({ error: 'job_not_found' });
  }
  if (jobRow.line_user_id !== auth.lineUserId) {
    // 所有者本人の line_user_id はログに出さない (PII 最小化)
    console.warn('[api/log-slide] ownership mismatch', {
      jobId, actualUser: auth.lineUserId
    });
    res.statusCode = 403;
    return res.json({ error: 'job_not_owned' });
  }

  // スライド更新
  const updateRow = { status };
  // image_url は https URL のみ受理 (javascript: 等のスキーム混入を防ぐ)
  const imageUrl = pickString(body.image_url, 2000);
  if (imageUrl && /^https:\/\//.test(imageUrl)) updateRow.image_url = imageUrl;
  const errMsg = pickString(body.error, 1000);
  if (errMsg) updateRow.error = errMsg;
  const workspaceIdx = pickInt(body.workspace_idx);
  if (workspaceIdx !== null) updateRow.workspace_idx = workspaceIdx;
  const elapsedMs = pickInt(body.elapsed_ms);
  if (elapsedMs !== null) updateRow.elapsed_ms = elapsedMs;

  const { data: updRows, error: updErr } = await supabase
    .from('generation_slides')
    .update(updateRow)
    .eq('job_id', jobId)
    .eq('slide_idx', slideIdx)
    .select('slide_idx');

  if (updErr) {
    console.error('[api/log-slide] generation_slides update failed:', updErr.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }
  // 対象スライドが存在しなかった (0行更新) 場合は成功と偽らず 404 を返す
  if (!Array.isArray(updRows) || updRows.length === 0) {
    console.warn('[api/log-slide] slide not found', { jobId, slideIdx });
    res.statusCode = 404;
    return res.json({ error: 'slide_not_found' });
  }

  res.statusCode = 200;
  return res.json({ ok: true });
};
