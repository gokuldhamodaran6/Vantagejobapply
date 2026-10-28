-- (applied as crawl_stats_cheaper) The stats query outgrew its time limit at ~900k open jobs (failing every 10 min
-- since 2026-10-27 17:30). Companies and per-system counts now come from the boards' own crawl counts.
create or replace function private.crawl_refresh_stats() returns void
language plpgsql security definer
set search_path to 'public', 'private'
set statement_timeout to '240s'
as $function$
begin
  insert into private.crawl_stats as s (id, open_jobs, companies, boards_live, boards_known, systems, new_24h, by_ats, updated_at)
  select 1,
    (select count(*) from public.jobs where closed_at is null),
    (select count(distinct coalesce(nullif(b.name_norm, ''), lower(b.name))) from public.boards b where b.status = 'active' and coalesce(b.last_count, 0) > 0),
    (select count(*) from public.boards where status = 'active'),
    (select count(*) from public.boards where status <> 'off'),
    (select count(distinct ats) from public.boards where status = 'active'),
    (select count(*) from public.jobs where closed_at is null and first_seen_at > now() - interval '24 hours'),
    (select jsonb_object_agg(ats, n) from (select b.ats, sum(coalesce(b.last_count, 0))::bigint n from public.boards b where b.status = 'active' group by b.ats having sum(coalesce(b.last_count, 0)) > 0) x),
    now()
  on conflict (id) do update set open_jobs = excluded.open_jobs, companies = excluded.companies, boards_live = excluded.boards_live,
    boards_known = excluded.boards_known, systems = excluded.systems, new_24h = excluded.new_24h, by_ats = excluded.by_ats, updated_at = now();
end $function$;
