-- =====================================================================
-- user_tags: 'god' タグを 'agent' へ移行
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN。
--
-- 背景:
--   最上位ティアの呼称を GOD → AGENT に改名した (ルート /god-max → /pro-agent、
--   合言葉ページ /god → /pro-agent-unlock、API /api/grant-god → /api/grant-agent)。
--   /api/grant-agent は今後 'agent' タグを付与するが、改名前に付与済みのユーザーは
--   user_tags に 'god' を持ったままなので、ここで既存行を移行する。
--
-- 設計方針:
--   - 単純な `update ... set tag='agent'` は使わない。user_tags には
--     unique (line_user_id, tag) があるため、既に 'agent' も持っているユーザーが
--     いると一意制約違反で移行全体が落ちるため。
--   - 「'agent' を insert (競合は無視) → 'god' を delete」の 2 段構えにすることで
--     冪等になり、何度流しても安全。
--   - 1 トランザクションにまとめ、途中で失敗しても中途半端な状態を残さない。
--
-- 適用後にできること (任意):
--   app.js の PLAN_FEATURES / TAG_FEATURE_GRANTS に残してある旧称 'god' の
--   後方互換エントリを削除できる。このマイグレーションを流すまでは残しておくこと。
-- =====================================================================

begin;

-- 'god' タグ保有者に 'agent' タグを付与 (既に持っていれば何もしない)
insert into public.user_tags (line_user_id, tag)
select line_user_id, 'agent'
  from public.user_tags
 where tag = 'god'
on conflict (line_user_id, tag) do nothing;

-- 旧 'god' タグを撤去
delete from public.user_tags
 where tag = 'god';

commit;

-- ---------------------------------------------------------------------
-- 確認用 (移行後に実行する。god = 0 件、agent = 移行済み件数になっていればOK)
-- ---------------------------------------------------------------------
-- select tag, count(*) from public.user_tags
--  where tag in ('god', 'agent')
--  group by tag
--  order by tag;
