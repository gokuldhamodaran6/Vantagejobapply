-- Vantage job crawler, part 3: company lists, search over open jobs, pruning and schedules.

-- ------------------------------------------------------------------ company lists
-- Public lists of companies and the careers system each one uses. Every entry is checked by the
-- crawler before it shows up anywhere: boards that don't answer are dropped automatically.
create table if not exists private.seed_sources (
  url text primary key,
  ats text,                 -- null when the file holds several systems
  fmt text not null,        -- csv_name_slug_url | json_slugs | json_directory
  req_id bigint,
  fetched_at timestamptz,
  imported int
);
create index if not exists boards_ats_lower_token_idx on public.boards (ats, lower(token), coalesce(site, ''));

insert into private.seed_sources (url, ats, fmt) values
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/greenhouse.csv', 'greenhouse', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/lever.csv', 'lever', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/ashby.csv', 'ashby', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/workable.csv', 'workable', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/recruitee.csv', 'recruitee', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/personio.csv', 'personio', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/pinpoint.csv', 'pinpoint', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/teamtailor.csv', 'teamtailor', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/workday.csv', 'workday', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/rippling.csv', 'rippling', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/breezy.csv', 'breezy', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/bamboohr.csv', 'bamboohr', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/gem.csv', 'gem', 'csv_name_slug_url'),
  ('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/greenhouse_companies.json', 'greenhouse', 'json_slugs'),
  ('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/lever_companies.json', 'lever', 'json_slugs'),
  ('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/ashby_companies.json', 'ashby', 'json_slugs'),
  ('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/bamboohr_companies.json', 'bamboohr', 'json_slugs'),
  ('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/workday_companies.json', 'workday', 'json_slugs'),
  ('https://kalebconfer-sys.github.io/job-board-directory/job-board-directory.json', null, 'json_directory')
on conflict (url) do nothing;

create or replace function private.seed_fetch() returns int
language plpgsql security definer set search_path = public, private, extensions as $$
declare s record; n int := 0;
begin
  for s in select * from private.seed_sources loop
    update private.seed_sources set req_id = net.http_get(s.url, timeout_milliseconds => 60000) where url = s.url;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Add one candidate board unless it is already known (case-insensitive).
create or replace function private.seed_rows(rows jsonb, via text) returns int
language sql security definer set search_path = public, private as $$
  with r as (
    select distinct on (x ->> 'ats', lower(x ->> 'token'), coalesce(x ->> 'site', ''))
      x ->> 'ats' as ats, x ->> 'token' as token, coalesce(x ->> 'site', '') as site,
      nullif(x ->> 'host', '') as host, nullif(x ->> 'region', '') as region,
      left(coalesce(nullif(btrim(x ->> 'name'), ''), x ->> 'token'), 120) as name
    from jsonb_array_elements(rows) x
    where coalesce(x ->> 'token', '') ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$'
      and x ->> 'ats' in ('greenhouse','lever','ashby','workable','recruitee','workday','personio','teamtailor','rippling','pinpoint','breezy','bamboohr','gem')
      and lower(x ->> 'token') not in ('embed','jobs','api','auth','v1','apply','careers','job_board','internal','www')
      and (x ->> 'ats' <> 'workday' or (coalesce(x ->> 'host', '') <> '' and coalesce(x ->> 'site', '') <> ''))
  ), ins as (
    insert into public.boards (ats, token, name, host, site, region, status, active, next_run_at, discovered_via)
    select r.ats, r.token, r.name, r.host, r.site, r.region, 'pending', true,
      now() + make_interval(secs => floor(random() * 10800)::int), via
    from r
    where not exists (select 1 from public.boards b where b.ats = r.ats and lower(b.token) = lower(r.token) and coalesce(b.site, '') = r.site)
    on conflict (ats, token, site) do nothing
    returning 1
  )
  select count(*)::int from ins
$$;

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

-- ------------------------------------------------------------------ search
create or replace function public.search_jobs(p_country text, p_tsquery text, p_since timestamptz, p_limit integer default 400)
returns table(id text, source text, country text, title text, company text, location text, remote boolean, description text,
  url text, salary_min numeric, salary_max numeric, currency text, category text, contract_time text, posted_at timestamptz,
  sponsorship text, sponsor_registered boolean, restrictions text[], rank real)
language sql stable set search_path = public as $$
  select j.id, j.source, j.country, j.title, j.company, j.location, j.remote, left(j.description, 3500), j.url,
         j.salary_min, j.salary_max, j.currency, j.category, j.contract_time, j.posted_at,
         j.sponsorship, j.sponsor_registered, j.restrictions, ts_rank(j.fts, q) as rank
  from public.jobs j, to_tsquery('english', p_tsquery) q
  where j.country = upper(p_country)
    and j.closed_at is null
    and j.fts @@ q
    and coalesce(j.posted_at, j.first_seen_at) >= p_since
  order by ts_rank(j.fts, q) desc, j.posted_at desc nulls last
  limit least(greatest(p_limit, 1), 600);
$$;

-- Same search with the freshness facts the Jobs page needs (first seen, reposts, which board).
create or replace function public.search_jobs2(p_country text, p_tsquery text, p_since timestamptz, p_limit integer default 800)
returns table(id text, source text, country text, title text, company text, location text, remote boolean, description text,
  url text, salary_min numeric, salary_max numeric, currency text, category text, contract_time text, posted_at timestamptz,
  sponsorship text, sponsor_registered boolean, restrictions text[], first_seen_at timestamptz, reposts int, rank real)
language sql stable set search_path = public as $$
  select j.id, j.source, j.country, j.title, j.company, j.location, j.remote, left(j.description, 3500), j.url,
         j.salary_min, j.salary_max, j.currency, j.category, j.contract_time, j.posted_at,
         j.sponsorship, j.sponsor_registered, j.restrictions, j.first_seen_at, j.reposts, ts_rank(j.fts, q) as rank
  from public.jobs j, to_tsquery('english', p_tsquery) q
  where j.country = upper(p_country)
    and j.closed_at is null
    and j.fts @@ q
    and coalesce(j.posted_at, j.first_seen_at) >= p_since
  order by ts_rank(j.fts, q) desc, coalesce(j.posted_at, j.first_seen_at) desc
  limit least(greatest(p_limit, 1), 1000);
$$;
grant execute on function public.search_jobs2(text, text, timestamptz, integer) to authenticated, service_role;

-- ------------------------------------------------------------------ pruning
-- Closed jobs are kept for 120 days so reposts can be recognised; jobs someone applied to are kept forever.
create or replace function public.prune_jobs(secret text, days integer default 45)
returns integer language plpgsql security definer set search_path = public, private as $$
declare n int; m int; k int;
begin
  perform private.check_secret(secret);
  delete from public.jobs where source = 'adzuna' and coalesce(posted_at, fetched_at) < now() - make_interval(days => days)
    and id not in (select job_id from public.applications where job_id is not null);
  get diagnostics n = row_count;
  -- Amazon is still read by the app (search API), so its old rows age out by fetch time.
  delete from public.jobs where source = 'amazon' and fetched_at < now() - interval '2 days'
    and id not in (select job_id from public.applications where job_id is not null);
  get diagnostics m = row_count;
  delete from public.jobs where closed_at < now() - interval '120 days'
    and id not in (select job_id from public.applications where job_id is not null);
  get diagnostics k = row_count;
  return n + m + k;
end $$;

-- Boards a user adds or re-adds are read on the next tick.
create or replace function public.upsert_board(secret text, p jsonb)
returns bigint language plpgsql security definer set search_path = public, private as $$
declare bid bigint;
begin
  perform private.check_secret(secret);
  insert into public.boards (ats, token, name, industry, country, host, site, added_by, status, next_run_at)
  values (p->>'ats', p->>'token', p->>'name', p->>'industry', p->>'country', p->>'host', coalesce(p->>'site',''),
    nullif(p->>'added_by','')::uuid, case when p->>'ats' = 'smartrecruiters' then 'off' else 'active' end, now())
  on conflict (ats, token, site) do update set
    name = case when boards.name = boards.token or boards.discovered_via is not null then coalesce(excluded.name, boards.name) else boards.name end,
    industry = coalesce(excluded.industry, boards.industry),
    country = coalesce(excluded.country, boards.country),
    host = coalesce(excluded.host, boards.host),
    active = boards.status <> 'off',
    status = case when boards.status in ('dead', 'empty', 'pending') then 'active' else boards.status end,
    next_run_at = least(boards.next_run_at, now())
  returning id into bid;
  return bid;
end $$;

create or replace function public.list_boards(secret text)
returns setof public.boards language plpgsql security definer set search_path = public, private as $$
begin
  perform private.check_secret(secret);
  -- Only the boards the app itself still reads (Amazon); everything else is read by the database crawler.
  return query select * from public.boards where active and ats = 'amazon' order by last_ok_at nulls first;
end $$;

-- ------------------------------------------------------------------ schedules
select cron.schedule('vantage-crawl', '20 seconds', $$select private.crawl_tick()$$);
select cron.schedule('vantage-crawl-stats', '*/10 * * * *', $$select private.crawl_refresh_stats()$$);
select cron.schedule('vantage-seed-collect', '* * * * *', $$select private.seed_collect() where exists (select 1 from private.seed_sources where req_id is not null)$$);
select cron.schedule('vantage-seed-weekly', '17 4 * * 0', $$select private.seed_fetch()$$);

-- ------------------------------------------------------------------ app helpers
create or replace function private.ats_of_prefix(p text) returns text
language sql immutable set search_path = '' as $$
  select case p when 'gh' then 'greenhouse' when 'wd' then 'workday' when 'wk' then 'workable' when 'rc' then 'recruitee'
    when 'sr' then 'smartrecruiters' when 'ps' then 'personio' when 'tt' then 'teamtailor' when 'rp' then 'rippling'
    when 'pp' then 'pinpoint' when 'bz' then 'breezy' when 'bh' then 'bamboohr' else p end
$$;

-- Who added each board ("prefix:token" keys from job ids), for auto-apply's vetting.
create or replace function public.board_info(secret text, keys text[])
returns table(key text, added_by uuid, name text) language plpgsql security definer set search_path = public, private as $$
begin
  perform private.check_secret(secret);
  return query
    select distinct on (k.k) k.k, b.added_by, b.name
    from unnest(keys) k(k)
    join public.boards b on b.ats = private.ats_of_prefix(split_part(k.k, ':', 1)) and b.token = split_part(k.k, ':', 2)
    order by k.k, b.added_by nulls first;
end $$;

-- Save a description the app fetched (Workday lists don't include one) and refresh the visa signals.
create or replace function public.set_job_description(secret text, p_id text, p_description text)
returns void language plpgsql security definer set search_path = public, private as $$
declare t text; s record;
begin
  perform private.check_secret(secret);
  select title into t from public.jobs where id = p_id;
  if not found then return; end if;
  select * into s from private.job_signals(t, p_description);
  update public.jobs set description = left(p_description, 6000), sponsorship = s.sponsorship, restrictions = s.restrictions,
    remote = remote or s.remote
  where id = p_id and description is null;
end $$;
