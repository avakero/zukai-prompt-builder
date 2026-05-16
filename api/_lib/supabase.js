// Supabase service_role クライアントのファクトリ。
// service_role は RLS をバイパスするため、絶対にクライアント側に渡してはいけない。
// このモジュールは api/ 配下からのみ require されること。

const { createClient } = require('@supabase/supabase-js');

let cached = null;

function getSupabaseAdmin() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  cached = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: { 'X-Client-Info': 'figure-builder-api/1.0' }
    }
  });
  return cached;
}

module.exports = { getSupabaseAdmin };
