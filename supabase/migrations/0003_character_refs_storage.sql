-- =====================================================================
-- Phase 3: キャラクター参照画像ストレージ
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN。
--   Phase 1 / Phase 2 が既に適用されていることが前提。
--
-- 設計方針:
--   - キャラクター参照画像を一時保管する Storage バケットを作成。
--   - 画像生成API (Pickaxe) が外部から取得できるよう public read。
--   - アップロードはサービスロール経由のみ (RLSはサービスロールには
--     適用されないため、APIエンドポイント /api/upload-character-image
--     で LINE 認証を行ったあと service_role でアップロードする)。
--   - パスは `character-refs/{line_user_id}/{uuid}.{ext}` 形式。
--   - 24時間で自動削除する想定 (cron + storage.objects.created_at で
--     別途運用、または手動で清掃)。
-- =====================================================================

-- ---------------------------------------------------------------------
-- Storage バケット作成
-- ---------------------------------------------------------------------
-- 注: Supabase Studio の Storage 画面から手動作成しても良いが、SQL でも作れる。
--     既に存在する場合は何もしない。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'character-refs',
  'character-refs',
  true,  -- public read (Pickaxe 等の外部APIが直接GETするため)
  10 * 1024 * 1024,  -- 10MB/file
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
-- 既存バケットには手を付けない (Studio 等で行った運用変更を再実行で巻き戻さないため)。
-- バケット設定を変えたい場合は Studio から手動で行うこと。
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- RLS ポリシー
-- ---------------------------------------------------------------------
-- public バケットなので read は全員許可される (Supabase の既定挙動)。
-- write は service_role のみ許可 (RLS をバイパスする)。
-- anon/authenticated からの直接アップロードは禁止。
--
-- 念のため明示的に anon/authenticated の insert/update/delete を拒否する
-- ポリシーは追加しない (storage.objects のデフォルトで anon は何もできない)。

-- ---------------------------------------------------------------------
-- (任意) 古い画像を削除するための関数
-- ---------------------------------------------------------------------
-- 24時間以上前にアップロードされた character-refs バケット内の画像を削除。
-- pg_cron で日次実行する想定 (Supabase Studio > Database > Cron Jobs)。
create or replace function public.cleanup_old_character_refs()
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
    where bucket_id = 'character-refs'
      and created_at < now() - interval '24 hours'
    returning 1
  )
  select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

comment on function public.cleanup_old_character_refs is
  '24時間以上前にアップロードされた character-refs バケット内のオブジェクトを削除する。pg_cron で日次実行を推奨。';
