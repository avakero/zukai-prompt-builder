// POST /api/upload-character-image
// 入力 : Authorization: Bearer <LIFF access token>
//        body (JSON) : { dataUrl: "data:image/png;base64,..." , filename?: string }
// 出力 : 200 { publicUrl, path, mimeType, sizeBytes }
//        400 { error: 'invalid_body' | 'invalid_data_url' | 'unsupported_mime' | 'image_too_large' }
//        401 { error: 'invalid_token' | 'expired_token' | 'audience_mismatch' }
//        405 { error: 'method_not_allowed' }
//        500 { error: 'internal_error' | 'upload_failed' }
//
// 動作:
//   - LINE userId を検証
//   - data URL を base64 デコードして Supabase Storage `character-refs` バケットへ
//     `{line_user_id}/{uuid}.{ext}` というパスでアップロード
//   - public read のバケットなので、得られる公開 URL をそのまま Pickaxe の
//     imageUrls に渡せる
//
// 注意:
//   - Vercel のリクエストボディ上限 (4.5MB) を考慮し、サーバ側でも 5MB ガードを設置。
//     base64 は元バイナリの約4/3倍なので、実画像 ~3.5MB が上限の目安。
//   - 24時間程度で削除する運用 (0003_character_refs_storage.sql の関数参照)。

const { randomUUID } = require('crypto');
const { authenticateFromAuthorizationHeader, VerificationError } = require('./_lib/line');
const { getSupabaseAdmin } = require('./_lib/supabase');
const { applyCors, handlePreflight } = require('./_lib/cors');

const ALLOW_METHODS = 'POST, OPTIONS';
const BUCKET = 'character-refs';
const MAX_BYTES = 5 * 1024 * 1024; // 5MB after decode

const MIME_TO_EXT = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/webp': 'webp',
  'image/gif':  'gif'
};

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([a-zA-Z0-9._+\-/]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const base64 = m[2];
  return { mime, base64 };
}

async function readJsonBody(req) {
  // Vercel の Node ランタイムは req.body を自動 parse する場合があるが、
  // raw stream のままのケースもあるので両対応。
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
      console.warn('[api/upload-character-image] auth failed', { code: e.code });
      res.statusCode = e.httpStatus;
      return res.json({ error: e.code });
    }
    console.error('[api/upload-character-image] unexpected auth error:', e);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  // 入力検証
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    return res.json({ error: 'invalid_body' });
  }
  const parsed = parseDataUrl(body.dataUrl);
  if (!parsed) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_data_url' });
  }
  const ext = MIME_TO_EXT[parsed.mime];
  if (!ext) {
    res.statusCode = 400;
    return res.json({ error: 'unsupported_mime' });
  }

  let buffer;
  try {
    buffer = Buffer.from(parsed.base64, 'base64');
  } catch {
    res.statusCode = 400;
    return res.json({ error: 'invalid_data_url' });
  }

  if (buffer.length === 0) {
    res.statusCode = 400;
    return res.json({ error: 'invalid_data_url' });
  }
  if (buffer.length > MAX_BYTES) {
    res.statusCode = 400;
    return res.json({ error: 'image_too_large' });
  }

  // アップロード
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[api/upload-character-image] supabase init failed:', e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  const path = `${auth.lineUserId}/${randomUUID()}.${ext}`;
  const { error: uploadErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: parsed.mime,
      upsert: false,
      cacheControl: '3600'
    });

  if (uploadErr) {
    console.error('[api/upload-character-image] storage upload failed:', uploadErr.message);
    res.statusCode = 500;
    return res.json({ error: 'upload_failed' });
  }

  const { data: publicUrlData } = supabase
    .storage
    .from(BUCKET)
    .getPublicUrl(path);

  const publicUrl = publicUrlData && publicUrlData.publicUrl ? publicUrlData.publicUrl : null;
  if (!publicUrl) {
    console.error('[api/upload-character-image] missing public URL after upload');
    res.statusCode = 500;
    return res.json({ error: 'upload_failed' });
  }

  res.statusCode = 200;
  return res.json({
    publicUrl,
    path,
    mimeType: parsed.mime,
    sizeBytes: buffer.length
  });
};
