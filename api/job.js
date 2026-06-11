// GET /api/job?id=<uuid>
// 入力 : Authorization: Bearer <LIFF access token>
//        query.id = generation_jobs.id (uuid)
// 出力 : 200 {
//          job: {
//            id, created_at, expires_at, completed_at,
//            preset_code, preset_label, style_prompt,
//            model, aspect_ratio, total_slides,
//            has_character_refs, status
//          },
//          slides: [
//            { slide_idx, content, image_url, status, error,
//              workspace_idx, elapsed_ms, updated_at }, ...
//          ]
//        }
//        400 { error: 'invalid_id' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        403 { error: 'job_not_owned' }
//        404 { error: 'job_not_found' }
//        405 { error: 'method_not_allowed' }
//        500 { error: 'internal_error' | 'db_error' }
//
// 設計:
//   - generation_jobs.line_user_id と認証ユーザーが一致するジョブのみ返す。
//   - expires_at を過ぎていても (cleanup_old_generation_jobs が未実行で残っていれば)
//     一応取得できる。クライアント側で created_at を見て古すぎる場合は復元しない判断もOK。
//   - 用途: ブラウザを閉じた後の再訪で「前回の生成結果」を復元表示する。

const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { applyCors, handlePreflight } = require('./_lib/cors');

const ALLOW_METHODS = 'GET, OPTIONS';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res, ALLOW_METHODS)) return;
  applyCors(req, res, ALLOW_METHODS);

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', ALLOW_METHODS);
    return res.json({ error: 'method_not_allowed' });
  }

  // クエリパラメータ
  const jobId = req.query && typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!jobId || !UUID_RE.test(jobId)) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_id' });
  }

  // 認証
  let auth;
  try {
    auth = await authenticateFromAuthorizationHeader(req.headers.authorization);
  } catch (e) {
    if (e instanceof VerificationError) {
      console.warn('[api/job] auth failed', { code: e.code });
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/job] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[api/job] supabase init failed:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // ジョブ取得 + 所有者確認
  const { data: jobRow, error: jobErr } = await supabase
    .from('generation_jobs')
    .select('id, line_user_id, created_at, expires_at, completed_at, preset_code, preset_label, style_prompt, model, aspect_ratio, total_slides, has_character_refs, status')
    .eq('id', jobId)
    .maybeSingle();

  if (jobErr) {
    console.error('[api/job] generation_jobs select failed:', jobErr.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }
  if (!jobRow) {
    res.statusCode = 404;
    return res.json({ error: 'job_not_found' });
  }
  if (jobRow.line_user_id !== auth.lineUserId) {
    // 所有者本人の line_user_id はログに出さない (PII 最小化)
    console.warn('[api/job] ownership mismatch', {
      jobId, actualUser: auth.lineUserId
    });
    res.statusCode = 403;
    return res.json({ error: 'job_not_owned' });
  }

  // スライド取得
  const { data: slideRows, error: slideErr } = await supabase
    .from('generation_slides')
    .select('slide_idx, content, image_url, status, error, workspace_idx, elapsed_ms, updated_at')
    .eq('job_id', jobId)
    .order('slide_idx', { ascending: true });

  if (slideErr) {
    console.error('[api/job] generation_slides select failed:', slideErr.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }

  // line_user_id はクライアントに返さない (auth で確認済みのため不要、最小公開原則)
  const { line_user_id: _omit, ...jobPublic } = jobRow;

  res.statusCode = 200;
  return res.json({
    job: jobPublic,
    slides: Array.isArray(slideRows) ? slideRows : []
  });
};
