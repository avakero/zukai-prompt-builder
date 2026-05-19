-- =====================================================================
-- Phase 4: 生成ジョブの永続化 (フェーズ1: 非破壊的なログ記録)
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN。
--   Phase 1/2/3 が既に適用されていることが前提
--   (set_updated_at 関数, gen_random_uuid 拡張に依存)。
--
-- 設計方針:
--   - 画像生成1回 = 1 generation_jobs 行 + N generation_slides 行。
--   - 現時点の app.js は依然ブラウザでオーケストレーションを行い、各完了時点で
--     fire-and-forget で API に POST するだけ (フェーズ1 = 観測のみ)。
--     将来 (フェーズ2) でサーバーオーケストレーションに移行する際の土台。
--   - RLS 完全閉鎖。service_role 経由でのみ Vercel から読み書きする。
--   - 24時間で expires_at を過ぎたジョブは cascade で slides ごと削除する関数を提供。
-- =====================================================================

-- ---------------------------------------------------------------------
-- generation_jobs: 1ジョブ = 1カルーセル生成セッション
-- ---------------------------------------------------------------------
create table if not exists public.generation_jobs (
  id                  uuid primary key default gen_random_uuid(),
  line_user_id        text not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '24 hours',
  preset_code         text,
  preset_label        text,
  style_prompt        text,
  model               text,
  aspect_ratio        text,
  total_slides        int not null check (total_slides > 0),
  has_character_refs  boolean not null default false,
  completed_at        timestamptz,
  -- ジョブ全体のステータスは slides から導出可能だが、明示フィールドも持つ
  -- (フェーズ2 でサーバーが完了マークする想定)
  status              text not null default 'running'
                       check (status in ('running', 'success', 'partial', 'failed'))
);

create index if not exists generation_jobs_user_recent_idx
  on public.generation_jobs (line_user_id, created_at desc);

create index if not exists generation_jobs_expires_at_idx
  on public.generation_jobs (expires_at);

alter table public.generation_jobs enable row level security;
-- 明示ポリシーなし = anon/authenticated からは一切アクセス不可。
-- service_role は RLS をバイパスするため Vercel からは読み書き可能。

-- ---------------------------------------------------------------------
-- generation_slides: 1スライド = 1行 (job_id, slide_idx) 複合 PK
-- ---------------------------------------------------------------------
create table if not exists public.generation_slides (
  job_id        uuid not null references public.generation_jobs(id) on delete cascade,
  slide_idx     int not null check (slide_idx >= 0),
  content       text,
  image_url     text,
  status        text not null default 'pending'
                  check (status in ('pending', 'running', 'success', 'failed')),
  error         text,
  workspace_idx int,
  elapsed_ms    int,
  updated_at    timestamptz not null default now(),
  primary key (job_id, slide_idx)
);

create index if not exists generation_slides_status_idx
  on public.generation_slides (status);

drop trigger if exists generation_slides_set_updated_at on public.generation_slides;
create trigger generation_slides_set_updated_at
  before update on public.generation_slides
  for each row execute function public.set_updated_at();

alter table public.generation_slides enable row level security;

-- ---------------------------------------------------------------------
-- 古いジョブ・スライドを削除する関数 (cascade で slides も消える)
-- ---------------------------------------------------------------------
-- pg_cron で日次実行する想定 (Supabase Studio > Database > Cron Jobs)
create or replace function public.cleanup_old_generation_jobs()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count int;
begin
  with deleted as (
    delete from public.generation_jobs
    where expires_at < now()
    returning 1
  )
  select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

comment on function public.cleanup_old_generation_jobs is
  'expires_at を過ぎた generation_jobs を削除する。slides は ON DELETE CASCADE で連動削除。pg_cron で日次実行推奨。';
