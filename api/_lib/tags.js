// user_tags 照会の共通ヘルパ
// (pickaxe-proxy / openai-image / gemini-image / straico で共用)
const { getSupabaseAdmin } = require('./supabase');

// 「開発者（オーナー本人）」を表すタグ。内蔵 API キー (OPENAI_API_KEY /
// GEMINI_API_KEY / STRAICO_API_KEY) と Straico プロバイダの利用はこのタグ
// 保有者のみに許可する。一般ユーザーは BYOK (自分のキー) が必須。
// 将来 'internal' / 'vip' を含めたくなったらここに追加する。
const DEV_TAGS = ['pickaxe_internal'];

// lineUserId が tags のいずれかを持っているか。
// Supabase 照会に失敗した場合は false (= アクセス拒否側に倒す)。
async function userHasAnyTag(lineUserId, tags) {
  if (!lineUserId || !Array.isArray(tags) || tags.length === 0) return false;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('user_tags')
      .select('tag')
      .eq('line_user_id', lineUserId)
      .in('tag', tags)
      .limit(1);
    if (error) {
      console.error('[tags] user_tags lookup failed:', error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.error('[tags] supabase init failed:', e && e.message);
    return false;
  }
}

// 開発者タグ (DEV_TAGS) を持っているか
function userIsDeveloper(lineUserId) {
  return userHasAnyTag(lineUserId, DEV_TAGS);
}

module.exports = { userHasAnyTag, userIsDeveloper, DEV_TAGS };
