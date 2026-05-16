-- =====================================================================
-- Phase 1: 中央認証API (/api/me) 用スキーマ
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN
--   (CLI で `supabase db push` を使う場合は supabase/ ディレクトリを
--    Supabase CLI から認識させる初期化が別途必要)
--
-- 設計方針:
--   - RLS 完全閉鎖。anon / authenticated には一切権限を渡さず、
--     Vercel から service_role キー経由でのみ読み書きする。
--   - LINE userId (`U` + 32 hex chars = 33 文字) を一次キーとして扱う。
--   - 初回 /api/me 成功時にデフォルト free プランで自動 upsert される
--     ため、運用者は手動で UPDATE して plan を昇格させるだけで良い。
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 共通: updated_at を自動更新するトリガ関数
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- subscriptions: ユーザーごとのプラン情報
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  plan         text not null default 'free'
                 check (plan in ('free', 'standard', 'pro', 'lifetime')),
  status       text not null default 'active'
                 check (status in ('active', 'past_due', 'canceled', 'paused')),
  started_at   timestamptz not null default now(),
  expires_at   timestamptz,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists subscriptions_plan_idx
  on public.subscriptions (plan);

create index if not exists subscriptions_expires_at_idx
  on public.subscriptions (expires_at)
  where expires_at is not null;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
-- 明示的なポリシーは作らない = anon/authenticated からは一切アクセス不可。
-- service_role はそもそも RLS をバイパスするため Vercel からは読み書き可能。

-- ---------------------------------------------------------------------
-- user_tags: ユーザーごとのタグ (beta, vip, internal など複数付与可)
-- ---------------------------------------------------------------------
create table if not exists public.user_tags (
  id           bigserial primary key,
  line_user_id text not null,
  tag          text not null,
  created_at   timestamptz not null default now(),
  unique (line_user_id, tag)
);

create index if not exists user_tags_line_user_id_idx
  on public.user_tags (line_user_id);

alter table public.user_tags enable row level security;

-- ---------------------------------------------------------------------
-- auth_audit_log: /api/me 呼び出しの監査ログ (運用 / デバッグ用)
-- ---------------------------------------------------------------------
create table if not exists public.auth_audit_log (
  id           bigserial primary key,
  line_user_id text,
  event        text not null,
  client_id    text,
  ip           text,
  user_agent   text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists auth_audit_log_line_user_id_idx
  on public.auth_audit_log (line_user_id);

create index if not exists auth_audit_log_created_at_idx
  on public.auth_audit_log (created_at desc);

alter table public.auth_audit_log enable row level security;
