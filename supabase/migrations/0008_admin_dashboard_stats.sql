-- =====================================================================
-- 管理者ダッシュボード用の集計 RPC (admin_dashboard_stats)
-- =====================================================================
-- 適用方法:
--   Supabase Studio > SQL Editor にこのファイルを貼り付けて RUN。
--
-- 背景:
--   /admin (管理者用インサイトダッシュボード) が /api/admin-stats 経由で呼ぶ。
--   supabase-js の select はデフォルト 1000 行上限があり、auth_audit_log
--   (90日保持) を JS 側で集計するとページングが必要になるため、
--   集計は全て DB 側で行い、1 回の RPC で JSON を返す。
--
-- 設計方針:
--   - security definer + search_path 固定。識別子は全てスキーマ修飾。
--   - PUBLIC / anon / authenticated から execute を剥奪し、service_role
--     のみに付与する (PostgREST 経由で匿名から叩けないようにする)。
--   - 日次バケットは日本運用のため Asia/Tokyo の暦日で切る。
--   - daily は generate_series で 90 日分ゼロ埋めして返す (チャート用)。
--   - LINE ユーザー ID はブラウザにフル値を渡さない (末尾 6 文字にマスク)。
--
-- データの保持期間 (ダッシュボードの注記と対応):
--   - auth_audit_log     … 90 日 (0006 のクリーンアップ関数)
--   - generation_jobs    … 24 時間 (0004 の expires_at + クリーンアップ)
-- =====================================================================

create or replace function public.admin_dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
select jsonb_build_object(
  'generatedAt', now(),

  -- ユーザー数 (entitlements ベース。/api/me 初回呼び出しで自動作成される)
  'users', (
    select jsonb_build_object(
      'total',      count(distinct line_user_id),
      'newLast7d',  count(distinct line_user_id) filter (where created_at >= now() - interval '7 days'),
      'newLast30d', count(distinct line_user_id) filter (where created_at >= now() - interval '30 days')
    )
    from public.entitlements
  ),

  -- プラン内訳 (製品横断。現状は zukai-builder のみ)
  'byPlan', (
    select coalesce(jsonb_object_agg(plan, cnt), '{}'::jsonb)
    from (select plan, count(*) as cnt from public.entitlements group by plan) t
  ),

  -- タグ内訳
  'byTag', (
    select coalesce(jsonb_object_agg(tag, cnt), '{}'::jsonb)
    from (select tag, count(*) as cnt from public.user_tags group by tag) t
  ),

  -- アクティブユーザー (auth_audit_log の me_called をアクティビティの代理指標にする。
  -- ログイン済みでアプリを開くと必ず /api/me が飛ぶため「アプリを開いた」とほぼ等価)
  'activity', (
    select jsonb_build_object(
      'dau', count(distinct line_user_id) filter (where created_at >= now() - interval '1 day'),
      'wau', count(distinct line_user_id) filter (where created_at >= now() - interval '7 days'),
      'mau', count(distinct line_user_id)
    )
    from public.auth_audit_log
    where event = 'me_called'
      and line_user_id is not null
      and created_at >= now() - interval '30 days'
  ),

  -- 日次系列 (直近 90 日、JST 暦日、ゼロ埋め済み)
  'daily', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'date',        to_char(d.day, 'YYYY-MM-DD'),
        'activeUsers', coalesce(a.users, 0),
        'calls',       coalesce(a.calls, 0),
        'newUsers',    coalesce(s.new_users, 0)
      ) order by d.day), '[]'::jsonb)
    from generate_series(
        (now() at time zone 'Asia/Tokyo')::date - 89,
        (now() at time zone 'Asia/Tokyo')::date,
        interval '1 day') as d(day)
    left join (
      select (created_at at time zone 'Asia/Tokyo')::date as day,
             count(distinct line_user_id) as users,
             count(*)                     as calls
      from public.auth_audit_log
      where event = 'me_called'
        and line_user_id is not null
        and created_at >= now() - interval '91 days'
      group by 1
    ) a on a.day = d.day::date
    left join (
      select (created_at at time zone 'Asia/Tokyo')::date as day,
             count(distinct line_user_id) as new_users
      from public.entitlements
      where created_at >= now() - interval '91 days'
      group by 1
    ) s on s.day = d.day::date
  ),

  -- 生成ジョブ (保持期間 24h のため「直近 24 時間」のスナップショット)
  'jobs', (
    select jsonb_build_object(
      'total',             count(*),
      'activeUsers',       count(distinct line_user_id),
      'withCharacterRefs', count(*) filter (where has_character_refs),
      'byStatus', (
        select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
        from (select status, count(*) as cnt from public.generation_jobs group by status) t
      ),
      'byModel', (
        select coalesce(jsonb_object_agg(model, cnt), '{}'::jsonb)
        from (select coalesce(model, '(未記録)') as model, count(*) as cnt
              from public.generation_jobs group by 1) t
      ),
      'byPreset', (
        select coalesce(jsonb_object_agg(preset, cnt), '{}'::jsonb)
        from (select coalesce(preset_label, preset_code, '(未記録)') as preset, count(*) as cnt
              from public.generation_jobs group by 1) t
      )
    )
    from public.generation_jobs
  ),

  -- スライド集計 (同じく直近 24h)
  'slides', (
    select jsonb_build_object(
      'total', count(*),
      'byStatus', (
        select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
        from (select status, count(*) as cnt from public.generation_slides group by status) t
      ),
      'avgElapsedMs', round(avg(elapsed_ms) filter (where status = 'success' and elapsed_ms is not null))
    )
    from public.generation_slides
  ),

  -- 直近ジョブ一覧 (最新 20 件。ユーザー ID は末尾 6 文字にマスク)
  'recentJobs', (
    select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
    from (
      select j.created_at,
             jsonb_build_object(
               'at',        to_char(j.created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI'),
               'userMask',  '…' || right(j.line_user_id, 6),
               'preset',    coalesce(j.preset_label, j.preset_code, '—'),
               'model',     coalesce(j.model, '—'),
               'slides',    j.total_slides,
               'okSlides',  (select count(*) from public.generation_slides s
                             where s.job_id = j.id and s.status = 'success'),
               'status',    j.status
             ) as item
      from public.generation_jobs j
      order by j.created_at desc
      limit 20
    ) t
  )
);
$$;

comment on function public.admin_dashboard_stats is
  '/api/admin-stats (管理者ダッシュボード) 用の集計。service_role からのみ実行可。';

-- PostgREST 経由で匿名から叩けないよう execute 権限を絞る
revoke all on function public.admin_dashboard_stats() from public;
revoke all on function public.admin_dashboard_stats() from anon;
revoke all on function public.admin_dashboard_stats() from authenticated;
grant execute on function public.admin_dashboard_stats() to service_role;

-- ---------------------------------------------------------------------
-- 確認用 (適用後に service_role で実行するか、Studio でそのまま実行)
-- ---------------------------------------------------------------------
-- select jsonb_pretty(public.admin_dashboard_stats());
