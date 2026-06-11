-- =====================================================================
-- Phase 2: マルチアプリ対応の機能ゲート用スキーマ
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN。
--   `subscriptions` テーブルが存在し、Phase 1 の 0001 が既に適用されて
--   いることが前提。
--
-- 設計方針:
--   - 1 ユーザー × N 製品 のエンタイトルメント基盤に拡張。
--   - 既存 `subscriptions` を `entitlements` にリネームし、製品コードを
--     必須カラムとして追加。
--   - `products` マスタを新設し、将来の新製品はここに 1 行追加するだけ
--     で /api/me が動くようにする。
--   - `user_tags` と `auth_audit_log` は引き続きユーザー横断のまま。
-- =====================================================================

-- ---------------------------------------------------------------------
-- products: 製品マスタ
-- ---------------------------------------------------------------------
create table if not exists public.products (
  code        text primary key,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

alter table public.products enable row level security;

insert into public.products (code, name, description) values
  ('zukai-builder', '図解プロンプトビルダー (PRO MAX)', 'カルーセル画像 + AI生成')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- subscriptions → entitlements リネーム + product_code 追加
-- ---------------------------------------------------------------------
-- 冪等化: 既にリネーム済み (再実行時) は何もしない
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'subscriptions')
     and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'entitlements')
  then
    alter table public.subscriptions rename to entitlements;
  end if;
end $$;

alter table public.entitlements
  add column if not exists product_code text references public.products(code);

-- 既存行は zukai-builder にバックフィル
update public.entitlements
  set product_code = 'zukai-builder'
  where product_code is null;

alter table public.entitlements
  alter column product_code set not null;

-- 旧 unique(line_user_id) を外して複合 unique を張る
alter table public.entitlements
  drop constraint if exists subscriptions_line_user_id_key;

-- 冪等化: 制約が既にあれば何もしない (ADD CONSTRAINT に IF NOT EXISTS はないため)
do $$
begin
  alter table public.entitlements
    add constraint entitlements_user_product_uniq unique (line_user_id, product_code);
exception
  -- UNIQUE/PK 制約はバッキングインデックスの関係で 42P07 (duplicate_table)、
  -- その他の制約は 42710 (duplicate_object) で重複が報告されるため両方握る
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

-- インデックス
create index if not exists entitlements_product_code_idx
  on public.entitlements (product_code);

create index if not exists entitlements_user_product_idx
  on public.entitlements (line_user_id, product_code);

-- トリガ名整理(Postgres 9.2+)
-- 冪等化: ALTER TRIGGER に IF EXISTS はないため、旧名トリガが無ければスキップ
do $$
begin
  alter trigger subscriptions_set_updated_at on public.entitlements
    rename to entitlements_set_updated_at;
exception
  when undefined_object then null;
end $$;
