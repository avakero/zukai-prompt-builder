-- =====================================================================
-- Phase 6: auth_audit_log のクリーンアップ関数
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN。
--
-- 背景:
--   auth_audit_log には TTL がなく無限に成長する。他の時限テーブル
--   (generation_jobs / generation_slides / Storage バケット) と同様に
--   cleanup 関数を用意し、pg_cron の日次ジョブに追加する。
--   保持期間は 90 日 (監査用途として十分な期間を確保しつつ無限成長を防ぐ)。
--
-- pg_cron 登録 (Supabase Studio > Database > Cron Jobs):
--   select public.cleanup_old_auth_audit_log();
-- =====================================================================

create or replace function public.cleanup_old_auth_audit_log()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count int;
begin
  with deleted as (
    delete from public.auth_audit_log
    where created_at < now() - interval '90 days'
    returning 1
  )
  select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

comment on function public.cleanup_old_auth_audit_log is
  '90日以上前の auth_audit_log 行を削除する。pg_cron で日次実行を推奨。';
