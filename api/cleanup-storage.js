// GET /api/cleanup-storage  (Vercel Cron 専用)
//
// character-refs / generated-images バケットの 24h を過ぎたファイルを削除する。
// Supabase は storage.objects への直接 DELETE を保護トリガー (storage.protect_delete)
// で禁止しているため、SQL の cleanup 関数では消せない。Storage API 経由でのみ削除可能。
// そのため DB レコードの掃除 (pg_cron) とは別に、この HTTP エンドポイントを Vercel Cron
// から日次で叩いて実ファイルを消す。
//
// 認証:
//   Vercel Cron は CRON_SECRET 環境変数が設定されていると、cron 実行時に
//   Authorization: Bearer <CRON_SECRET> を自動付与する。それを検証して
//   外部からの不正呼び出しを弾く。CRON_SECRET 未設定なら検証をスキップする
//   (ローカル検証用。本番では必ず設定すること)。
//
// パス構造: {line_user_id}/{uuid}.{ext}
//   トップレベルを list するとフォルダ (line_user_id) が返り、各フォルダ配下に
//   ファイルがある。フォルダは id=null、ファイルは id と created_at を持つ。

const { getSupabaseAdmin } = require('./_lib/supabase');

const BUCKETS = ['character-refs', 'generated-images'];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24時間
const LIST_LIMIT = 1000;

async function cleanupBucket(supabase, bucket, cutoffMs) {
  let deleted = 0;
  const { data: entries, error: listErr } = await supabase
    .storage.from(bucket)
    .list('', { limit: LIST_LIMIT });
  if (listErr) {
    console.error(`[cleanup-storage] list root failed (${bucket}):`, listErr.message);
    return { deleted, error: listErr.message };
  }

  for (const entry of entries || []) {
    // ファイル (id あり) がトップ直下に居る異常系も一応 created_at で判定して消す
    if (entry.id) {
      if (entry.created_at && new Date(entry.created_at).getTime() < cutoffMs) {
        const { error } = await supabase.storage.from(bucket).remove([entry.name]);
        if (!error) deleted++;
      }
      continue;
    }
    // フォルダ (= line_user_id)。配下のファイルをページングで辿る。
    const prefix = entry.name;
    let offset = 0;
    while (true) {
      const { data: files, error: fileErr } = await supabase
        .storage.from(bucket)
        .list(prefix, { limit: LIST_LIMIT, offset });
      if (fileErr) {
        console.error(`[cleanup-storage] list files failed (${bucket}/${prefix}):`, fileErr.message);
        break;
      }
      if (!files || files.length === 0) break;

      const stale = files
        .filter(f => f.id && f.created_at && new Date(f.created_at).getTime() < cutoffMs)
        .map(f => `${prefix}/${f.name}`);
      if (stale.length > 0) {
        const { error: rmErr } = await supabase.storage.from(bucket).remove(stale);
        if (rmErr) {
          console.error(`[cleanup-storage] remove failed (${bucket}/${prefix}):`, rmErr.message);
        } else {
          deleted += stale.length;
        }
      }
      if (files.length < LIST_LIMIT) break;
      offset += LIST_LIMIT;
    }
  }
  return { deleted };
}

module.exports = async function handler(req, res) {
  // Vercel Cron からの呼び出しのみ許可 (CRON_SECRET 設定時)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = (req.headers.authorization || '').toString();
    if (auth !== `Bearer ${secret}`) {
      res.statusCode = 401;
      return res.json({ error: 'unauthorized' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    return res.json({ error: 'method_not_allowed' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('[cleanup-storage] supabase init failed:', e && e.message);
    res.statusCode = 500;
    return res.json({ error: 'internal_error' });
  }

  const cutoffMs = Date.now() - MAX_AGE_MS;
  const results = {};
  for (const bucket of BUCKETS) {
    results[bucket] = await cleanupBucket(supabase, bucket, cutoffMs);
  }
  console.log('[cleanup-storage] done', results);
  res.statusCode = 200;
  return res.json({ ok: true, results });
};
