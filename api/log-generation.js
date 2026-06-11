// POST /api/log-generation
// 入力 : Authorization: Bearer <LIFF access token>
//        body (JSON) :
//          {
//            job_id:             "uuid",      // client-generated (idempotency key)
//            preset_code?:       string,
//            preset_label?:      string,
//            style_prompt?:      string,
//            model?:             string,
//            aspect_ratio?:      string,
//            total_slides:       int,
//            has_character_refs?:boolean,
//            slides: [ { slide_idx: int, content?: string }, ... ]
//          }
// 出力 : 200 { jobId }
//        400 { error: 'invalid_body' | 'invalid_job_id' | 'invalid_slides' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        500 { error: 'internal_error' | 'db_error' }
//
// 設計メモ:
//   - フェーズ1では「ブラウザが生成を開始する瞬間に記録するだけ」の用途。
//     生成自体はブラウザがオーケストレーションを続け、各スライドの完了は
//     /api/log-slide で別途記録される。
//   - job_id はクライアント生成 UUID。同じ ID で再 POST した場合は 200 を返す
//     (UPSERT 相当)。
//   - 失敗してもクライアントは生成を続行する想定 (fire-and-forget)。

const { VerificationError } = require('./_lib/line');
const { authenticateWithTemporaryProMax } = require('./_lib/temp-access');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { applyCors, handlePreflight } = require('./_lib/cors');
const { readJsonBody } = require('./_lib/request');

const ALLOW_METHODS = 'POST, OPTIONS';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      console.warn('[api/log-generation] auth failed', { code: e.code });
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/log-generation] unexpected auth error:', e);
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

  const totalSlides = pickInt(body.total_slides);
  if (!totalSlides || totalSlides < 1 || totalSlides > 50) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_slides' });
  }

  const slides = Array.isArray(body.slides) ? body.slides : null;
  if (!slides || slides.length !== totalSlides) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_slides' });
  }

  // 各 slide の slide_idx をチェック
  const slideRows = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const idx = pickInt(s && s.slide_idx);
    if (idx === null || idx < 0 || idx >= totalSlides) {
      res.statusCode = 400;
      return res.json({ error: 'invalid_slides' });
    }
    slideRows.push({
      job_id:    jobId,
      slide_idx: idx,
      content:   pickString(s.content, 4000),
      status:    'pending'
    });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[api/log-generation] supabase init failed:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // generation_jobs を upsert (同じ job_id で再 POST されても OK)
  const jobRow = {
    id:                 jobId,
    line_user_id:       auth.lineUserId,
    preset_code:        pickString(body.preset_code, 200),
    preset_label:       pickString(body.preset_label, 200),
    style_prompt:       pickString(body.style_prompt, 4000),
    model:              pickString(body.model, 200),
    aspect_ratio:       pickString(body.aspect_ratio, 100),
    total_slides:       totalSlides,
    has_character_refs: !!body.has_character_refs,
    status:             'running'
  };

  const { error: jobErr } = await supabase
    .from('generation_jobs')
    .upsert(jobRow, { onConflict: 'id', ignoreDuplicates: false });

  if (jobErr) {
    console.error('[api/log-generation] generation_jobs upsert failed:', jobErr.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }

  // 全 slides を upsert (1スライド = 1行)
  const { error: slideErr } = await supabase
    .from('generation_slides')
    .upsert(slideRows, { onConflict: 'job_id,slide_idx', ignoreDuplicates: false });

  if (slideErr) {
    console.error('[api/log-generation] generation_slides upsert failed:', slideErr.message);
    res.statusCode = 500;
    return res.json({ error: 'db_error' });
  }

  res.statusCode = 200;
  return res.json({ jobId });
};
