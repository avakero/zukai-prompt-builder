-- =====================================================================
-- Phase 5: 生成済み画像のストレージバケット
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN。
--   Phase 1/2/3/4 が既に適用されていることが前提。
--
-- 設計方針:
--   - OpenAI / Gemini API は画像を base64 で返すため、Vercel proxy 内で一度
--     decode して Supabase Storage 'generated-images' バケットへ保存する。
--   - 保存パス: `{line_user_id}/{uuid}.{ext}`
--   - public read (画像タグから直接 GET できる)
--   - アップロードはサービスロールのみ (RLS 経由は許可しない)
--   - 24時間で自動削除 (character-refs と同じパターン)
--
-- 価値:
--   - data URL (1〜2MB) を JSON 応答に乗せる従来方式と比べて応答サイズ激減
--   - 共有可能な恒久 URL を持つことで「あとから再訪して結果を見る」UX が実装可能
--   - generation_slides.image_url にも通常の URL が入るので将来のクエリが軽い
-- =====================================================================

-- ---------------------------------------------------------------------
-- Storage バケット作成
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'generated-images',
  'generated-images',
  true,
  10 * 1024 * 1024,  -- 10MB/file
  array['image/png', 'image/jpeg', 'image/webp']
)
-- 既存バケットには手を付けない (Studio 等で行った運用変更を再実行で巻き戻さないため)。
-- バケット設定を変えたい場合は Studio から手動で行うこと。
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- RLS ポリシー
-- ---------------------------------------------------------------------
-- public バケットなので read は全員許可される (Supabase の既定挙動)。
-- write は service_role のみ許可 (RLS をバイパスする)。
-- anon/authenticated からの直接アップロードは禁止 (storage.objects のデフォルト)。

-- ---------------------------------------------------------------------
-- 24時間で古い画像を削除する関数
-- ---------------------------------------------------------------------
-- pg_cron で日次実行する想定 (Supabase Studio > Database > Cron Jobs)。
create or replace function public.cleanup_old_generated_images()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count int;
begin
  with deleted as (
    delete from storage.objects
    where bucket_id = 'generated-images'
      and created_at < now() - interval '24 hours'
    returning 1
  )
  select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

comment on function public.cleanup_old_generated_images is
  '24時間以上前にアップロードされた generated-images バケット内のオブジェクトを削除する。pg_cron で日次実行を推奨。';
