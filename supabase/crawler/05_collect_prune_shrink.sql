-- Vantage job engine, final step. Paste this whole file into Supabase > SQL Editor and press Run.
-- It installs the crawler's collect/schedule steps and the daily cleanup, and shrinks the jobs table
-- (full descriptions -> short requirement summaries; search index keeps title + company only).
-- It does not touch users, applications, settings or resumes.

alter table public.boards drop constraint if exists boards_ats_check;
alter table public.boards add constraint boards_ats_check check (ats in (
  'greenhouse','lever','ashby','smartrecruiters','workable','recruitee','workday','amazon',
  'personio','teamtailor','rippling','pinpoint','breezy','bamboohr','gem'));
alter table public.boards drop constraint if exists boards_status_check;
alter table public.boards add constraint boards_status_check check (status in ('pending','active','empty','dead','off'));
update public.boards set status = 'off', active = false where ats = 'smartrecruiters';
update public.boards set status = 'active', next_run_at = now() where ats <> 'smartrecruiters' and active;

update public.jobs j set board_id = b.id
from public.boards b
where j.board_id is null
  and b.token = split_part(j.id, ':', 2)
  and b.ats = case split_part(j.id, ':', 1)
    when 'gh' then 'greenhouse' when 'lever' then 'lever' when 'ashby' then 'ashby' when 'wd' then 'workday'
    when 'wk' then 'workable' when 'rc' then 'recruitee' when 'sr' then 'smartrecruiters' when 'amazon' then 'amazon' end;

drop index if exists public.jobs_fts_idx;
alter table public.jobs drop column if exists fts;
update public.jobs set
  title_norm = private.title_norm(title),
  first_seen_at = coalesce(posted_at, fetched_at, now()),
  desc_len = length(description),
  description = private.req_excerpt(description);
alter table public.jobs add column fts tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(company, '')), 'B')) stored;
create index if not exists jobs_fts_open_idx on public.jobs using gin (fts) where closed_at is null;
alter table public.jobs set (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.jobs alter column description set compression lz4;

-- Assemble a Workday board once all its pages are in.
create or replace function private.crawl_wd_finish(p_board bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare w private.crawl_wd; got int; bad int; items jsonb; res jsonb;
begin
  select * into w from private.crawl_wd where board_id = p_board;
  if not found then return; end if;
  select count(*), count(*) filter (where p.items is null) into got, bad from private.crawl_pages p where p.board_id = p_board;
  if got < w.expected then return; end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into items
  from private.crawl_pages p, jsonb_array_elements(coalesce(p.items, '[]'::jsonb)) e where p.board_id = p_board;
  res := private.crawl_ingest(p_board, items, bad = 0 and not w.capped);
  update public.boards set capped = w.capped where id = p_board;
  perform private.crawl_finish(p_board, true, 200, null, (res ->> 'items')::int, (res ->> 'changed')::boolean, (res ->> 'held')::boolean);
  delete from private.crawl_pages where board_id = p_board;
  delete from private.crawl_wd where board_id = p_board;
end $$;

-- Handle one finished request.
create or replace function private.crawl_handle(b public.boards, f private.crawl_inflight, code int, body text)
returns void language plpgsql security definer set search_path = public, private, extensions as $$
declare parsed jsonb; res jsonb; sig text; cnt int; total int; pages int;
begin
  if b.ats = 'workday' and f.kind = 'page' then
    if not exists (select 1 from private.crawl_wd w where w.board_id = b.id) then return; end if;
    insert into private.crawl_pages (board_id, page, items)
    values (b.id, f.page, case when code between 200 and 299 then (private.parse_workday(body, b.host, b.site)) -> 'items' end)
    on conflict (board_id, page) do update set items = excluded.items;
    perform private.crawl_wd_finish(b.id);
    return;
  end if;

  if code not between 200 and 299 or body is null then
    perform private.crawl_finish(b.id, false, code, 'http ' || code, 0, false);
    return;
  end if;

  if b.ats = 'greenhouse' and f.kind = 'list' then
    -- Light read first: only fetch full descriptions when something changed.
    select md5(coalesce(string_agg((x ->> 'id') || '@' || (x ->> 'updated_at'), ',' order by x ->> 'id'), '')), count(*)
      into sig, cnt from jsonb_array_elements((body::jsonb) -> 'jobs') x;
    if cnt = 0 then
      res := private.crawl_ingest(b.id, '[]'::jsonb, true);
      perform private.crawl_finish(b.id, true, code, null, 0, (res ->> 'changed')::boolean, (res ->> 'held')::boolean);
    elsif sig = b.sig and b.status = 'active' then
      perform private.crawl_finish(b.id, true, code, null, cnt, false);
    else
      perform private.crawl_send(b, 'full', 0, sig);
    end if;
    return;
  end if;

  if b.ats = 'workday' then
    parsed := private.parse_workday(body, b.host, b.site);
    total := coalesce((parsed ->> 'total')::int, 0);
    pages := least(ceil(least(total, 2000) / 20.0)::int, 100);
    if pages <= 1 then
      res := private.crawl_ingest(b.id, parsed -> 'items', true);
      perform private.crawl_finish(b.id, true, code, null, (res ->> 'items')::int, (res ->> 'changed')::boolean, (res ->> 'held')::boolean);
    else
      insert into private.crawl_wd (board_id, expected, capped) values (b.id, pages, total >= 2000)
      on conflict (board_id) do update set expected = excluded.expected, capped = excluded.capped, started_at = now();
      delete from private.crawl_pages where board_id = b.id;
      insert into private.crawl_pages (board_id, page, items) values (b.id, 0, parsed -> 'items');
      insert into private.crawl_queue (board_id, page) select b.id, g from generate_series(1, pages - 1) g on conflict do nothing;
    end if;
    return;
  end if;

  parsed := case b.ats
    when 'greenhouse' then private.parse_greenhouse(body)
    when 'lever' then private.parse_lever(body)
    when 'ashby' then private.parse_ashby(body)
    when 'workable' then private.parse_workable(body, b.token)
    when 'recruitee' then private.parse_recruitee(body, b.token)
    when 'personio' then private.parse_personio(body, coalesce(nullif(b.host, ''), b.token || '.jobs.personio.de'))
    when 'teamtailor' then private.parse_teamtailor(body)
    when 'rippling' then private.parse_rippling(body)
    when 'pinpoint' then private.parse_pinpoint(body, b.token)
    when 'breezy' then private.parse_breezy(body)
    when 'bamboohr' then private.parse_bamboohr(body, b.token)
    when 'gem' then private.parse_gem(body)
  end;
  if parsed is null then
    perform private.crawl_finish(b.id, false, -1, 'unsupported system', 0, false);
    return;
  end if;
  res := private.crawl_ingest(b.id, parsed -> 'items', (parsed ->> 'next') is null);
  if b.ats = 'greenhouse' and not coalesce((res ->> 'held')::boolean, false) then
    update public.boards set sig = f.note where id = b.id;
  end if;
  -- Seed lists often only know the slug; use the employer's real name from the feed.
  if coalesce(parsed ->> 'name', '') <> '' and b.discovered_via is not null and b.name = b.token then
    update public.boards set name = left(parsed ->> 'name', 120) where id = b.id;
  end if;
  perform private.crawl_finish(b.id, true, code, null, (res ->> 'items')::int, (res ->> 'changed')::boolean, (res ->> 'held')::boolean);
end $$;

create or replace function private.crawl_collect(budget interval default interval '14 seconds') returns int
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  f private.crawl_inflight;
  b public.boards;
  r record;
  code int;
  body text;
  started timestamptz := clock_timestamp();
  n int := 0;
begin
  for f in select * from private.crawl_inflight order by sent_at limit 300 loop
    exit when clock_timestamp() - started > budget;
    select status_code, content into code, body from net._http_response where id = f.req_id;
    if not found then
      continue when f.sent_at > now() - interval '3 minutes';   -- still waiting
      code := 0;
      body := null;
    end if;
    select * into b from public.boards where id = f.board_id;
    if found then
      begin
        perform private.crawl_handle(b, f, coalesce(code, 0), body);
      exception when others then
        if b.ats = 'workday' and f.kind = 'page' then
          insert into private.crawl_pages (board_id, page, items) values (b.id, f.page, null)
          on conflict (board_id, page) do update set items = null;
          perform private.crawl_wd_finish(b.id);
        else
          perform private.crawl_finish(b.id, false, -1, left('parse: ' || sqlerrm, 200), 0, false);
        end if;
      end;
    end if;
    delete from net._http_response where id = f.req_id;
    delete from private.crawl_inflight where req_id = f.req_id;
    n := n + 1;
  end loop;
  -- Workday boards whose pages never all arrived: store what came back, without closing anything.
  for r in select board_id from private.crawl_wd where started_at < now() - interval '30 minutes' loop
    update private.crawl_wd set expected = 0, capped = true where board_id = r.board_id;
    delete from private.crawl_queue where board_id = r.board_id;
    perform private.crawl_wd_finish(r.board_id);
  end loop;
  return n;
end $$;

-- Per tick (20 s): at most this many boards per careers system, so no site is hit hard.
create or replace function private.crawl_dispatch() returns int
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  r record;
  n int := 0;
  lim jsonb := '{"greenhouse":30,"lever":12,"ashby":15,"workday":5,"workable":8,"recruitee":8,"personio":8,"teamtailor":6,"rippling":6,"pinpoint":4,"breezy":6,"bamboohr":6,"gem":4}';
  b public.boards;
begin
  if (select count(*) from private.crawl_inflight) > 400 then return 0; end if;

  -- Workday pages: up to 3 per company per tick.
  for r in
    select x.board_id, x.page from (
      select q.*, row_number() over (partition by q.board_id order by q.page) rn from private.crawl_queue q) x
    where x.rn <= 3 order by x.board_id, x.page limit 60
  loop
    select * into b from public.boards where id = r.board_id;
    if found then perform private.crawl_send(b, 'page', r.page); end if;
    delete from private.crawl_queue where board_id = r.board_id and page = r.page;
    n := n + 1;
  end loop;

  for r in
    select d.id from jsonb_each_text(lim) l(ats, cap)
    cross join lateral (
      select b2.id from public.boards b2
      where b2.ats = l.ats and b2.status in ('pending', 'active', 'empty') and b2.next_run_at <= now()
        and not exists (select 1 from private.crawl_inflight f where f.board_id = b2.id)
        and not exists (select 1 from private.crawl_wd w where w.board_id = b2.id)
      order by b2.next_run_at
      limit l.cap::int) d
  loop
    select * into b from public.boards where id = r.id;
    if b.ats = 'workday' and (coalesce(b.host, '') = '' or coalesce(b.site, '') = '') then
      update public.boards set status = 'dead', active = false, last_error = 'missing Workday host/site' where id = b.id;
      continue;
    end if;
    perform private.crawl_send(b, 'list', 0);
    -- Lease: if nothing comes back the board is retried later.
    update public.boards set next_run_at = now() + interval '20 minutes' where id = b.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function private.crawl_tick() returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare c int; s int;
begin
  if not pg_try_advisory_xact_lock(7316001) then return jsonb_build_object('skipped', true); end if;
  c := private.crawl_collect();
  s := private.crawl_dispatch();
  return jsonb_build_object('collected', c, 'sent', s);
end $$;

-- Live numbers for the app, refreshed every 10 minutes.
create or replace function private.crawl_refresh_stats() returns void
language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.crawl_stats as s (id, open_jobs, companies, boards_live, boards_known, systems, new_24h, by_ats, updated_at)
  select 1,
    (select count(*) from public.jobs where closed_at is null),
    (select count(distinct company_norm) from public.jobs where closed_at is null),
    (select count(*) from public.boards where status = 'active'),
    (select count(*) from public.boards where status <> 'off'),
    (select count(distinct ats) from public.boards where status = 'active'),
    (select count(*) from public.jobs where closed_at is null and first_seen_at > now() - interval '24 hours'),
    (select jsonb_object_agg(ats, n) from (select b.ats, count(*) n from public.jobs j join public.boards b on b.id = j.board_id where j.closed_at is null group by b.ats) x),
    now()
  on conflict (id) do update set open_jobs = excluded.open_jobs, companies = excluded.companies, boards_live = excluded.boards_live,
    boards_known = excluded.boards_known, systems = excluded.systems, new_24h = excluded.new_24h, by_ats = excluded.by_ats, updated_at = now();
end $$;

create or replace function public.job_stats() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce((select to_jsonb(s) - 'id' from private.crawl_stats s where id = 1), '{}'::jsonb)
$$;
grant execute on function public.job_stats() to anon, authenticated;

-- Ask the crawler to read these boards on its next tick (used when a user adds or targets a company).
create or replace function public.crawl_now(secret text, ids bigint[]) returns int
language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  perform private.check_secret(secret);
  update public.boards set next_run_at = now(), status = case when status in ('dead', 'empty') then 'pending' else status end
  where id = any (ids) and status <> 'off' and ats <> 'amazon';
  get diagnostics n = row_count;
  return n;
end $$;

-- Daily cleanup: closed jobs go after 7 days (a fingerprint stays 120 days for repost detection),
-- open jobs older than 120 days go, cached full texts go after 30 days. Applied-to jobs are always kept.
create or replace function public.prune_jobs(secret text, days integer default 45)
returns integer language plpgsql security definer set search_path = public, private as $$
declare n int; m int; k int;
begin
  perform private.check_secret(secret);
  delete from public.jobs where source = 'adzuna' and coalesce(posted_at, fetched_at) < now() - make_interval(days => days)
    and id not in (select job_id from public.applications where job_id is not null);
  get diagnostics n = row_count;
  delete from public.jobs where source = 'amazon' and fetched_at < now() - interval '2 days'
    and id not in (select job_id from public.applications where job_id is not null);
  get diagnostics m = row_count;
  with gone as (
    delete from public.jobs j
    where ((j.closed_at is not null and j.closed_at < now() - interval '7 days')
        or (j.closed_at is null and j.source <> 'amazon' and coalesce(j.posted_at, j.first_seen_at) < now() - interval '120 days'))
      and not exists (select 1 from public.applications a where a.job_id = j.id)
      and not exists (select 1 from public.agent_tasks t where t.job_id = j.id)
    returning j.board_id, j.title_norm, j.country, j.first_seen_at, coalesce(j.closed_at, now()) as closed_at, j.reposts
  )
  insert into private.job_fp (board_id, title_norm, country, first_seen_at, closed_at, reposts)
  select g.board_id, g.title_norm, g.country, min(g.first_seen_at), max(g.closed_at), max(g.reposts) from gone g
  where g.board_id is not null and g.title_norm is not null and g.country is not null
  group by g.board_id, g.title_norm, g.country
  on conflict (board_id, title_norm, country) do update set
    first_seen_at = least(job_fp.first_seen_at, excluded.first_seen_at),
    closed_at = greatest(job_fp.closed_at, excluded.closed_at),
    reposts = greatest(job_fp.reposts, excluded.reposts);
  get diagnostics k = row_count;
  delete from private.job_fp where closed_at < now() - interval '120 days';
  delete from private.job_text where fetched_at < now() - interval '30 days';
  return n + m + k;
end $$;

create or replace function private.seed_collect() returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare s record; body text; code int; rows jsonb; n int; out jsonb := '{}'::jsonb;
begin
  for s in select * from private.seed_sources where req_id is not null loop
    select status_code, content into code, body from net._http_response where id = s.req_id;
    continue when not found;
    rows := '[]'::jsonb;
    if code = 200 then
      begin
        if s.fmt = 'csv_name_slug_url' then
          select coalesce(jsonb_agg(case
              when s.ats = 'workday' then jsonb_build_object('ats', 'workday', 'name', btrim(m[1], '" '),
                'token', lower(split_part(m[2], '/', 1)), 'site', split_part(m[2], '/', 2),
                'host', lower(substring(m[3] from '^https?://([^/]+)')))
              when s.ats in ('personio', 'teamtailor') then jsonb_build_object('ats', s.ats, 'name', btrim(m[1], '" '),
                'token', lower(m[2]), 'host', lower(substring(m[3] from '^https?://([^/]+)')))
              when s.ats = 'lever' then jsonb_build_object('ats', 'lever', 'name', btrim(m[1], '" '), 'token', lower(m[2]),
                'region', case when m[3] like '%.eu.lever.co%' then 'eu' end)
              when s.ats in ('ashby', 'rippling') then jsonb_build_object('ats', s.ats, 'name', btrim(m[1], '" '), 'token', m[2])
              else jsonb_build_object('ats', s.ats, 'name', btrim(m[1], '" '), 'token', lower(m[2])) end), '[]'::jsonb)
          into rows
          from regexp_split_to_table(body, E'\r?\n') with ordinality l(line, i)
          cross join lateral regexp_match(l.line, '^(.*),([^,]*),([^,]*)$') m
          where l.i > 1 and m is not null;
        elsif s.fmt = 'json_slugs' then
          select coalesce(jsonb_agg(case
              when s.ats = 'workday' then jsonb_build_object('ats', 'workday', 'token', lower(split_part(v, '|', 1)),
                'site', split_part(v, '|', 3), 'host', lower(split_part(v, '|', 1)) || '.' || split_part(v, '|', 2) || '.myworkdayjobs.com')
              when s.ats = 'ashby' then jsonb_build_object('ats', 'ashby', 'token', v)
              else jsonb_build_object('ats', s.ats, 'token', lower(v)) end), '[]'::jsonb)
          into rows
          from jsonb_array_elements_text(body::jsonb) v
          where v <> '' and (s.ats <> 'workday' or v ~ '^[^|]+\|wd[0-9]+\|[^|]+$');
        elsif s.fmt = 'json_directory' then
          select coalesce(jsonb_agg(case
              when x ->> 'platform' = 'workday' then jsonb_build_object('ats', 'workday', 'name', x ->> 'company',
                'token', lower(split_part(x ->> 'token', '/', 2)), 'site', split_part(x ->> 'token', '/', 3),
                'host', lower(split_part(x ->> 'token', '/', 2)) || '.' || split_part(x ->> 'token', '/', 1) || '.myworkdayjobs.com')
              when x ->> 'platform' in ('personio', 'teamtailor') then jsonb_build_object('ats', x ->> 'platform', 'name', x ->> 'company',
                'token', lower(x ->> 'token'), 'host', lower(substring(x ->> 'board_url' from '^https?://([^/]+)')))
              when x ->> 'platform' in ('ashby', 'rippling') then jsonb_build_object('ats', x ->> 'platform', 'name', x ->> 'company', 'token', x ->> 'token')
              else jsonb_build_object('ats', x ->> 'platform', 'name', x ->> 'company', 'token', lower(x ->> 'token'),
                'region', case when x ->> 'board_url' like '%.eu.lever.co%' then 'eu' end) end), '[]'::jsonb)
          into rows
          from jsonb_array_elements(body::jsonb) x;
        end if;
      exception when others then
        rows := '[]'::jsonb;
      end;
    end if;
    n := private.seed_rows(rows, 'seed:' || split_part(split_part(s.url, '//', 2), '/', 1));
    update private.seed_sources set req_id = null, fetched_at = now(), imported = n where url = s.url;
    delete from net._http_response where id = s.req_id;
    out := out || jsonb_build_object(coalesce(s.ats, 'directory') || ':' || s.fmt, n);
  end loop;
  return out;
end $$;

