// 生成画像 (base64) を Supabase Storage 'generated-images' バケットに
// アップロードして公開URLを返すヘルパ。
//
// OpenAI gpt-image-2 と Gemini Imagen / Flash Image はどちらも base64 で
// 画像を返してくる。これを毎回 data URL として JSON 応答に乗せると
//   - 応答サイズが1-2MB級になり通信が重い
//   - 共有可能な URL がないので「あとから再訪して結果を見る」UX が組めない
//   - Supabase generation_slides.image_url に巨大文字列を詰め込むことになる
// 等の問題が出る。本ヘルパで Storage 経由に変換することで全部解決する。
//
// 保存パス: `{line_user_id}/{uuid}.{ext}`
// 24時間で自動削除される (cleanup_old_generated_images 関数を pg_cron で動かす想定)。

const { randomUUID } = require('crypto');
const { getSupabaseAdmin } = require('./supabase');

const BUCKET = 'generated-images';

function mimeToExt(mimeType) {
  if (!mimeType) return 'png';
  const m = mimeType.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  return 'png';
}

// b64Data: base64 文字列 (data URL ではなく純粋な base64 部分)
// mimeType: 'image/png' / 'image/jpeg' 等
// lineUserId: パスのプレフィックスに使う
async function uploadGeneratedImage(b64Data, mimeType, lineUserId) {
  if (!b64Data || typeof b64Data !== 'string') {
    throw new Error('uploadGeneratedImage: b64Data is required');
  }
  if (!lineUserId || typeof lineUserId !== 'string') {
    throw new Error('uploadGeneratedImage: lineUserId is required');
  }

  const buf = Buffer.from(b64Data, 'base64');
  if (buf.length === 0) {
    throw new Error('uploadGeneratedImage: decoded buffer is empty');
  }

  const ext = mimeToExt(mimeType);
  const ctype = mimeType && /^image\/[a-z]+$/i.test(mimeType) ? mimeType : 'image/png';
  const path = `${lineUserId}/${randomUUID()}.${ext}`;

  const supabase = getSupabaseAdmin();
  const { error: uploadErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, buf, {
      contentType: ctype,
      upsert: false,
      cacheControl: '3600'
    });

  if (uploadErr) {
    throw new Error(`storage upload failed: ${uploadErr.message}`);
  }

  const { data: publicUrlData } = supabase
    .storage
    .from(BUCKET)
    .getPublicUrl(path);

  const publicUrl = publicUrlData && publicUrlData.publicUrl ? publicUrlData.publicUrl : null;
  if (!publicUrl) {
    throw new Error('missing public URL after upload');
  }
  return { publicUrl, path, sizeBytes: buf.length, mimeType: ctype };
}

module.exports = { uploadGeneratedImage };
