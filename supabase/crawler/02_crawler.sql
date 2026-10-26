-- Vantage job crawler, part 2: requests, parsers, ingest and scheduling.
-- Every 20 seconds `private.crawl_tick()` collects finished feed reads and sends the next ones.
-- Only jobs that actually changed are written, closed jobs are marked (not deleted), and
-- reposts are linked to the job they replace.

create table if not exists private.crawl_inflight (
  req_id bigint primary key,
  board_id bigint not null,
  kind text not null,                 -- list | full | page
  page int not null default 0,
  note text,
  sent_at timestamptz not null default now()
);
create index if not exists crawl_inflight_board_idx on private.crawl_inflight (board_id);

-- Workday lists come 20 at a time; pages are gathered here until the board is complete.
create table if not exists private.crawl_wd (
  board_id bigint primary key,
  expected int not null,
  capped boolean not null default false,
  started_at timestamptz not null default now()
);
create table if not exists private.crawl_pages (
  board_id bigint not null,
  page int not null,
  items jsonb,                        -- null = this page failed
  primary key (board_id, page)
);
create table if not exists private.crawl_queue (
  board_id bigint not null,
  page int not null,
  primary key (board_id, page)
);
create table if not exists private.crawl_stats (
  id int primary key default 1,
  open_jobs bigint, companies bigint, boards_live bigint, boards_known bigint, systems int,
  new_24h bigint, by_ats jsonb, updated_at timestamptz
);

-- ------------------------------------------------------------------ parsers
-- Each parser turns one feed response into {items:[{x,t,l,c,r,d,u,p,k,smin,smax,cur}], name?, total?, next?}.
--   x id  t title  l location  c country  r remote  d description  u url  p posted  k contract

create or replace function private.parse_greenhouse(body text) returns jsonb
language sql stable set search_path = '' as $$
  with j as (select x from jsonb_array_elements((body::jsonb) -> 'jobs') x)
  select jsonb_build_object(
    'name', (select x ->> 'company_name' from j limit 1),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'x', x ->> 'id', 't', x ->> 'title', 'l', x -> 'location' ->> 'name',
      'r', exists (select 1 from jsonb_array_elements(case when jsonb_typeof(x -> 'metadata') = 'array' then x -> 'metadata' else '[]' end) m
                   where (m ->> 'value') ilike 'remote%'),
      'd', left(private.html_text(private.html_decode(x ->> 'content')), 6000),
      'u', x ->> 'absolute_url', 'p', coalesce(x ->> 'first_published', x ->> 'updated_at'))), '[]'::jsonb))
  from j
$$;

create or replace function private.parse_lever(body text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', x ->> 'text', 'l', x -> 'categories' ->> 'location', 'c', x ->> 'country',
    'r', (x ->> 'workplaceType') = 'remote',
    'd', left(concat_ws(E'\n', x ->> 'descriptionPlain',
      (select string_agg(concat(li ->> 'text', E'\n', private.html_text(li ->> 'content')), E'\n')
       from jsonb_array_elements(case when jsonb_typeof(x -> 'lists') = 'array' then x -> 'lists' else '[]' end) li),
      x ->> 'additionalPlain'), 6000),
    'u', x ->> 'hostedUrl', 'p', x ->> 'createdAt', 'k', x -> 'categories' ->> 'commitment',
    'smin', x -> 'salaryRange' ->> 'min', 'smax', x -> 'salaryRange' ->> 'max', 'cur', x -> 'salaryRange' ->> 'currency')), '[]'::jsonb))
  from jsonb_array_elements(body::jsonb) x
$$;

create or replace function private.parse_ashby(body text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', btrim(x ->> 'title'), 'l', x ->> 'location',
    'c', x -> 'address' -> 'postalAddress' ->> 'addressCountry',
    'r', private.jbool(x -> 'isRemote') or (x ->> 'workplaceType') = 'Remote',
    'd', left(x ->> 'descriptionPlain', 6000), 'u', coalesce(x ->> 'jobUrl', x ->> 'applyUrl'),
    'p', x ->> 'publishedAt', 'k', x ->> 'employmentType',
    'smin', s ->> 'minValue', 'smax', s ->> 'maxValue', 'cur', s ->> 'currencyCode')), '[]'::jsonb))
  from jsonb_array_elements((body::jsonb) -> 'jobs') x
  left join lateral (
    select c from jsonb_array_elements(case when jsonb_typeof(x -> 'compensation' -> 'summaryComponents') = 'array'
      then x -> 'compensation' -> 'summaryComponents' else '[]' end) c
    where c ->> 'compensationType' = 'Salary' limit 1) sc(s) on true
  where coalesce(x ->> 'isListed', 'true') <> 'false'
$$;

create or replace function private.parse_workday(body text, host text, site text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('total', ((body::jsonb) ->> 'total')::int, 'items', coalesce(jsonb_agg(jsonb_build_object(
    'x', coalesce(nullif(x -> 'bulletFields' ->> 0, ''), regexp_replace(x ->> 'externalPath', '^.*_', '')),
    't', x ->> 'title', 'l', x ->> 'locationsText',
    'r', coalesce(x ->> 'remoteType', '') ilike '%remote%' or coalesce(x ->> 'locationsText', '') ilike '%remote%',
    'u', 'https://' || host || '/en-US/' || site || (x ->> 'externalPath'),
    'p', private.wd_posted(x ->> 'postedOn'))), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof((body::jsonb) -> 'jobPostings') = 'array' then (body::jsonb) -> 'jobPostings' else '[]' end) x
  where x ->> 'externalPath' is not null
$$;

create or replace function private.parse_workable(body text, token text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('name', (body::jsonb) ->> 'name', 'items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'shortcode', 't', x ->> 'title',
    'l', coalesce(nullif(concat_ws(', ', nullif(x ->> 'city', ''), nullif(x ->> 'state', ''), nullif(x ->> 'country', '')), ''), x -> 'location' ->> 'location_str'),
    'c', coalesce(x -> 'location' ->> 'country_code', x ->> 'country'),
    'r', private.jbool(x -> 'telecommuting'),
    'd', left(private.html_text(coalesce(x ->> 'full_description', x ->> 'description')), 6000),
    'u', coalesce(x ->> 'url', x ->> 'shortlink', 'https://apply.workable.com/' || token || '/j/' || (x ->> 'shortcode') || '/'),
    'p', coalesce(x ->> 'published_on', x ->> 'created_at'), 'k', x ->> 'employment_type')), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof((body::jsonb) -> 'jobs') = 'array' then (body::jsonb) -> 'jobs' else '[]' end) x
$$;

create or replace function private.parse_recruitee(body text, token text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', x ->> 'title', 'l', coalesce(x ->> 'location', x ->> 'city'), 'c', x ->> 'country_code',
    'r', private.jbool(x -> 'remote'),
    'd', left(private.html_text(concat(x ->> 'description', E'\n', x ->> 'requirements')), 6000),
    'u', coalesce(x ->> 'careers_url', 'https://' || token || '.recruitee.com/o/' || (x ->> 'slug')),
    'p', coalesce(x ->> 'published_at', x ->> 'created_at'), 'k', x ->> 'employment_type_code',
    'smin', x -> 'salary' ->> 'min', 'smax', x -> 'salary' ->> 'max', 'cur', x -> 'salary' ->> 'currency')), '[]'::jsonb))
  from jsonb_array_elements((body::jsonb) -> 'offers') x
  where coalesce(x ->> 'status', 'published') = 'published'
$$;

create or replace function private.parse_personio(body text, host text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare doc xml;
begin
  doc := xmlparse(document regexp_replace(body, '^\s*<\?xml[^>]*\?>', ''));
  return (
    select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
      'x', (xpath('id/text()', p))[1]::text, 't', private.html_decode((xpath('name/text()', p))[1]::text),
      'l', private.html_decode((xpath('office/text()', p))[1]::text),
      'd', left(private.html_text(private.html_decode((select string_agg(v::text, E'\n') from unnest(xpath('jobDescriptions/jobDescription/value/text()', p)) v))), 6000),
      'u', 'https://' || host || '/job/' || (xpath('id/text()', p))[1]::text,
      'p', (xpath('createdAt/text()', p))[1]::text, 'k', (xpath('schedule/text()', p))[1]::text)), '[]'::jsonb))
    from unnest(xpath('/workzag-jobs/position', doc)) p);
end $$;

create or replace function private.parse_teamtailor(body text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('name', (body::jsonb) ->> 'title', 'next', (body::jsonb) ->> 'next_url',
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'x', x ->> 'id', 't', x ->> 'title', 'u', x ->> 'url',
      'p', coalesce(x ->> 'date_published', x -> '_jobposting' ->> 'datePosted'),
      'd', left(private.html_text(coalesce(x -> '_jobposting' ->> 'description', x ->> 'content_html')), 6000),
      'l', concat_ws(', ', nullif(a -> 'address' ->> 'addressLocality', ''), nullif(a -> 'address' ->> 'addressCountry', '')),
      'c', a -> 'address' ->> 'addressCountry',
      'r', coalesce(x -> '_jobposting' ->> 'jobLocationType', '') = 'TELECOMMUTE')), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof((body::jsonb) -> 'items') = 'array' then (body::jsonb) -> 'items' else '[]' end) x
  left join lateral (
    select l from jsonb_array_elements(case when jsonb_typeof(x -> '_jobposting' -> 'jobLocation') = 'array'
      then x -> '_jobposting' -> 'jobLocation' else '[]' end) l limit 1) al(a) on true
$$;

create or replace function private.parse_rippling(body text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('total', ((body::jsonb) ->> 'totalItems')::int, 'items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', x ->> 'name', 'u', x ->> 'url',
    'l', (select string_agg(l ->> 'name', ' | ') from jsonb_array_elements(case when jsonb_typeof(x -> 'locations') = 'array' then x -> 'locations' else '[]' end) l),
    'c', x -> 'locations' -> 0 ->> 'countryCode',
    'r', exists (select 1 from jsonb_array_elements(case when jsonb_typeof(x -> 'locations') = 'array' then x -> 'locations' else '[]' end) l
                 where l ->> 'workplaceType' = 'REMOTE'))), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof((body::jsonb) -> 'items') = 'array' then (body::jsonb) -> 'items' else '[]' end) x
$$;

create or replace function private.parse_pinpoint(body text, token text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', x ->> 'title',
    'u', coalesce(x ->> 'url', 'https://' || token || '.pinpointhq.com' || (x ->> 'path')),
    'l', x -> 'location' ->> 'name', 'r', coalesce(x ->> 'workplace_type', '') ilike 'remote%',
    'd', left(private.html_text(concat_ws(E'\n', x ->> 'description', x ->> 'key_responsibilities', x ->> 'skills_knowledge_expertise')), 6000),
    'k', x ->> 'employment_type',
    'smin', case when private.jbool(x -> 'compensation_visible') then x ->> 'compensation_minimum' end,
    'smax', case when private.jbool(x -> 'compensation_visible') then x ->> 'compensation_maximum' end,
    'cur', x ->> 'compensation_currency')), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof((body::jsonb) -> 'data') = 'array' then (body::jsonb) -> 'data' else '[]' end) x
$$;

create or replace function private.parse_breezy(body text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('name', (body::jsonb) -> 0 -> 'company' ->> 'name', 'items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', x ->> 'name', 'u', x ->> 'url', 'p', x ->> 'published_date',
    'l', x -> 'location' ->> 'name', 'c', x -> 'location' -> 'country' ->> 'id',
    'r', private.jbool(x -> 'location' -> 'is_remote'), 'k', x -> 'type' ->> 'name')), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof(body::jsonb) = 'array' then body::jsonb else '[]' end) x
$$;

create or replace function private.parse_bamboohr(body text, token text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', x ->> 'jobOpeningName', 'u', 'https://' || token || '.bamboohr.com/careers/' || (x ->> 'id'),
    'l', concat_ws(', ', nullif(coalesce(x -> 'atsLocation' ->> 'city', x -> 'location' ->> 'city'), ''),
                         nullif(coalesce(x -> 'atsLocation' ->> 'state', x -> 'location' ->> 'state'), ''),
                         nullif(x -> 'atsLocation' ->> 'country', '')),
    'c', x -> 'atsLocation' ->> 'country',
    'r', private.jbool(x -> 'isRemote') or coalesce(x ->> 'locationType', '') = '1',
    'k', x ->> 'employmentStatusLabel')), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof((body::jsonb) -> 'result') = 'array' then (body::jsonb) -> 'result' else '[]' end) x
$$;

create or replace function private.parse_gem(body text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'x', x ->> 'id', 't', x ->> 'title', 'u', x ->> 'absolute_url', 'l', x -> 'location' ->> 'name',
    'r', coalesce(x ->> 'location_type', '') ilike '%remote%',
    'p', coalesce(x ->> 'first_published_at', x ->> 'created_at'),
    'd', left(coalesce(nullif(x ->> 'content_plain', ''), private.html_text(x ->> 'content')), 6000),
    'k', x ->> 'employment_type')), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof(body::jsonb) = 'array' then body::jsonb else '[]' end) x
$$;

-- ------------------------------------------------------------------ requests
create or replace function private.crawl_send(b public.boards, kind text, page int default 0, note text default null)
returns bigint language plpgsql security definer set search_path = public, private, extensions as $$
declare
  h jsonb := jsonb_build_object('User-Agent', 'VantageJobs/1.0 (+https://vantagejobapply.onrender.com; reads public job boards for job seekers)',
                                'Accept', 'application/json');
  t text := replace(b.token, ' ', '%20');
  rid bigint;
  ms int := case when kind = 'full' or b.ats in ('lever', 'ashby') then 60000 else 30000 end;
begin
  rid := case b.ats
    when 'greenhouse' then net.http_get('https://boards-api.greenhouse.io/v1/boards/' || t || '/jobs' || case when kind = 'full' then '?content=true' else '' end, headers => h, timeout_milliseconds => ms)
    when 'lever' then net.http_get('https://api' || case when b.region = 'eu' then '.eu' else '' end || '.lever.co/v0/postings/' || t || '?mode=json', headers => h, timeout_milliseconds => ms)
    when 'ashby' then net.http_get('https://api.ashbyhq.com/posting-api/job-board/' || t || '?includeCompensation=true', headers => h, timeout_milliseconds => ms)
    when 'workday' then net.http_post('https://' || b.host || '/wday/cxs/' || t || '/' || replace(b.site, ' ', '%20') || '/jobs',
      jsonb_build_object('limit', 20, 'offset', page * 20, 'searchText', '', 'appliedFacets', '{}'::jsonb),
      headers => h || '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds => ms)
    when 'workable' then net.http_get('https://apply.workable.com/api/v1/widget/accounts/' || t || '?details=true', headers => h, timeout_milliseconds => ms)
    when 'recruitee' then net.http_get('https://' || t || '.recruitee.com/api/offers/', headers => h, timeout_milliseconds => ms)
    when 'personio' then net.http_get('https://' || coalesce(nullif(b.host, ''), t || '.jobs.personio.de') || '/xml?language=en', headers => h - 'Accept', timeout_milliseconds => ms)
    when 'teamtailor' then net.http_get('https://' || coalesce(nullif(b.host, ''), t || '.teamtailor.com') || '/jobs.json', headers => h, timeout_milliseconds => ms)
    when 'rippling' then net.http_get('https://api.rippling.com/platform/api/ats/v2/board/' || t || '/jobs?groupJobsByLocation=true&page=0&pageSize=1000', headers => h, timeout_milliseconds => ms)
    when 'pinpoint' then net.http_get('https://' || t || '.pinpointhq.com/postings.json', headers => h, timeout_milliseconds => ms)
    when 'breezy' then net.http_get('https://' || t || '.breezy.hr/json', headers => h, timeout_milliseconds => ms)
    when 'bamboohr' then net.http_get('https://' || t || '.bamboohr.com/careers/list', headers => h, timeout_milliseconds => ms)
    when 'gem' then net.http_get('https://api.gem.com/job_board/v0/' || t || '/job_posts/', headers => h, timeout_milliseconds => ms)
  end;
  if rid is null then return null; end if;
  insert into private.crawl_inflight (req_id, board_id, kind, page, note) values (rid, b.id, kind, page, note);
  return rid;
end $$;

-- ------------------------------------------------------------------ ingest
-- Store one board's jobs. Unchanged jobs are not rewritten; jobs that left a complete feed are closed.
create or replace function private.crawl_ingest(p_board bigint, items jsonb, complete boolean)
returns jsonb language plpgsql security definer set search_path = public, private, extensions as $$
declare
  b public.boards;
  pre text;
  ids text[];
  n_items int;
  n_new int := 0;
  n_upd int := 0;
  n_closed int := 0;
  prev_open int;
  held boolean := false;
begin
  select * into b from public.boards where id = p_board;
  if not found then return jsonb_build_object('error', 'no board'); end if;
  pre := case b.ats when 'greenhouse' then 'gh' when 'workday' then 'wd' when 'workable' then 'wk' when 'recruitee' then 'rc'
    when 'smartrecruiters' then 'sr' when 'personio' then 'ps' when 'teamtailor' then 'tt' when 'rippling' then 'rp'
    when 'pinpoint' then 'pp' when 'breezy' then 'bz' when 'bamboohr' then 'bh' else b.ats end;

  select array_agg(distinct pre || ':' || b.token || ':' || (i ->> 'x')) into ids
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i where coalesce(i ->> 'x', '') <> '';
  n_items := coalesce(array_length(ids, 1), 0);

  with src as (
    select distinct on (pre || ':' || b.token || ':' || (i ->> 'x'))
      pre || ':' || b.token || ':' || (i ->> 'x') as id,
      left(btrim(i ->> 't'), 300) as title,
      left(nullif(btrim(i ->> 'l'), ''), 300) as location,
      coalesce(private.country_code(i ->> 'c'), private.detect_country(i ->> 'l', coalesce(b.country, 'US'))) as country,
      private.jbool(i -> 'r') as remote_flag,
      nullif(btrim(i ->> 'd'), '') as descr,
      i ->> 'u' as url,
      private.ts(i ->> 'p') as posted,
      left(i ->> 'k', 80) as contract,
      private.num(i ->> 'smin') as smin, private.num(i ->> 'smax') as smax, nullif(i ->> 'cur', '') as cur
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
    where coalesce(i ->> 'x', '') <> '' and coalesce(btrim(i ->> 't'), '') <> '' and coalesce(i ->> 'u', '') like 'http%'
  ), h as (
    select s.*, md5(concat_ws('|', s.title, s.location, s.country, s.url, s.posted, left(s.descr, 3000), s.smin, s.smax, s.contract, s.remote_flag)) as hash
    from src s
  ), todo as (
    select h.* from h
    where not exists (select 1 from public.jobs j where j.id = h.id and j.hash = h.hash and j.closed_at is null)
  ), ins as (
    insert into public.jobs as j (id, source, country, title, company, company_norm, location, remote, description, url,
      salary_min, salary_max, currency, category, contract_time, posted_at, fetched_at, sponsorship, sponsor_registered,
      restrictions, board_id, hash, first_seen_at, repost_of, reposts, closed_at)
    select t.id, b.ats, t.country, t.title, b.name, public.norm_company(b.name), t.location,
      t.remote_flag or sig.remote or coalesce(t.location, '') ~* '\yremote\y|anywhere|work from home',
      t.descr, t.url, t.smin, t.smax, t.cur, b.industry, t.contract, coalesce(t.posted, now()), now(),
      sig.sponsorship,
      exists (select 1 from public.sponsors s where s.country = t.country and s.name_norm = public.norm_company(b.name)),
      sig.restrictions, b.id, t.hash, coalesce(rp.first_seen_at, now()), rp.id, coalesce(rp.reposts + 1, 0), null
    from todo t
    cross join lateral private.job_signals(t.title, t.descr) sig
    left join lateral (
      select r.id, r.first_seen_at, r.reposts from public.jobs r
      where r.board_id = b.id and r.title_norm = private.title_norm(t.title) and r.country = t.country and r.id <> t.id
        and r.closed_at is not null and r.closed_at > now() - interval '120 days'
      order by r.first_seen_at limit 1) rp on true
    on conflict (id) do update set
      title = excluded.title, company = excluded.company, company_norm = excluded.company_norm,
      location = excluded.location, country = excluded.country, remote = excluded.remote,
      description = coalesce(excluded.description, j.description), url = excluded.url,
      salary_min = excluded.salary_min, salary_max = excluded.salary_max, currency = excluded.currency,
      contract_time = excluded.contract_time, posted_at = coalesce(j.posted_at, excluded.posted_at), fetched_at = now(),
      sponsorship = case when excluded.description is null and j.description is not null then j.sponsorship else excluded.sponsorship end,
      restrictions = case when excluded.description is null and j.description is not null then j.restrictions else excluded.restrictions end,
      sponsor_registered = excluded.sponsor_registered, board_id = excluded.board_id, hash = excluded.hash, closed_at = null
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into n_new, n_upd from ins;

  select count(*) into prev_open from public.jobs where board_id = b.id and closed_at is null;
  if complete then
    if n_items = 0 and prev_open > 0 and coalesce(b.last_count, 0) > 0 then
      held := true;   -- one empty read is not enough to close everything; confirm on the next read
    elsif prev_open >= 20 and n_items < prev_open * 0.3 and coalesce(b.last_error, '') <> 'shrunk' then
      held := true;   -- a sudden drop of 70% or more is re-checked before closing
    else
      update public.jobs set closed_at = now()
      where board_id = b.id and closed_at is null and id <> all (coalesce(ids, '{}'::text[]));
      get diagnostics n_closed = row_count;
    end if;
  else
    -- Very large Workday boards only show their first 2,000 jobs, so close by last-seen time instead.
    update public.jobs set seen_at = now() where id = any (coalesce(ids, '{}'::text[]));
    update public.jobs set closed_at = now()
    where board_id = b.id and closed_at is null and coalesce(seen_at, first_seen_at) < now() - interval '3 days';
    get diagnostics n_closed = row_count;
  end if;

  return jsonb_build_object('items', n_items, 'new', n_new, 'updated', n_upd, 'closed', n_closed, 'held', held,
    'changed', (n_new + n_upd + n_closed) > 0);
end $$;

-- ------------------------------------------------------------------ scheduling
create or replace function private.is_target(b public.boards) returns boolean
language sql stable set search_path = public, private as $$
  select exists (select 1 from public.target_prefs t, unnest(t.companies) c where public.norm_company(c) = b.name_norm)
$$;

-- Record a read and decide when to read the board again.
--   ok + jobs: every 2h if it changed, 4h for big boards, 6h otherwise (15 min for companies a user targets)
--   ok + empty: daily; boards that never had jobs are dropped after three empty reads
--   failures back off exponentially; boards that never worked are dropped quickly
create or replace function private.crawl_finish(p_board bigint, ok boolean, code int, note text, n int, changed boolean, held boolean default false)
returns void language plpgsql security definer set search_path = public, private as $$
declare b public.boards; tgt boolean; jitter interval := make_interval(mins => floor(random() * 30)::int);
begin
  select * into b from public.boards where id = p_board;
  if not found then return; end if;
  tgt := private.is_target(b);
  if ok and held then
    update public.boards set last_run_at = now(), last_error = case when n = 0 then 'empty-once' else 'shrunk' end,
      last_count = n, next_run_at = now() + interval '30 minutes' where id = b.id;
  elsif ok and n > 0 then
    update public.boards set status = 'active', active = true, fail_count = 0, last_ok_at = now(), last_run_at = now(),
      last_count = n, last_error = null, last_change_at = case when changed then now() else last_change_at end,
      next_run_at = now() + case when tgt then interval '15 minutes' when changed then interval '2 hours'
                                 when n > 200 then interval '4 hours' else interval '6 hours' end + jitter
    where id = b.id;
  elsif ok then
    update public.boards set
      status = case when last_change_at is null and fail_count >= 2 then 'dead' else 'empty' end,
      active = not (last_change_at is null and fail_count >= 2),
      fail_count = case when last_change_at is null then fail_count + 1 else 0 end,
      last_ok_at = now(), last_run_at = now(), last_count = 0, last_error = null,
      next_run_at = now() + case when tgt then interval '30 minutes' when last_change_at is null then interval '3 days' else interval '1 day' end + jitter
    where id = b.id;
  elsif b.ats = 'lever' and code = 404 and b.last_ok_at is null and b.region is null then
    -- Some Lever boards live on the EU host; try it once.
    update public.boards set region = 'eu', next_run_at = now(), last_error = 'trying EU host' where id = b.id;
  elsif code in (400, 401, 403, 404, 410, 422) or code < 0 then
    update public.boards set
      fail_count = fail_count + 1, last_run_at = now(), last_error = left(coalesce(note, 'http ' || code), 200),
      status = case when b.last_ok_at is null or b.fail_count + 1 >= 6 then 'dead' else status end,
      active = not (b.last_ok_at is null or b.fail_count + 1 >= 6),
      next_run_at = now() + case when b.last_ok_at is null or b.fail_count + 1 >= 6 then interval '30 days'
                                 else least(make_interval(hours => power(2, least(b.fail_count, 8))::int), interval '7 days') end
    where id = b.id;
  else
    -- timeouts, 429 and 5xx: try again later
    update public.boards set
      fail_count = fail_count + 1, last_run_at = now(), last_error = left(coalesce(note, 'http ' || code), 200),
      status = case when b.last_ok_at is null and b.fail_count + 1 >= 4 then 'dead' else status end,
      next_run_at = now() + least(make_interval(mins => 30 * power(2, least(b.fail_count, 6))::int), interval '1 day')
    where id = b.id;
  end if;
end $$;

-- Assemble a Workday board once all its pages are in.
create or replace function private.crawl_wd_finish(p_board bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare w private.crawl_wd; got int; bad int; items jsonb; res jsonb;
begin
  select * into w from private.crawl_wd where board_id = p_board;
  if not found then return; end if;
  select count(*), count(*) filter (where items is null) into got, bad from private.crawl_pages where board_id = p_board;
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
    select board_id, page from (
      select q.*, row_number() over (partition by q.board_id order by q.page) rn from private.crawl_queue q) x
    where rn <= 3 order by board_id, page limit 60
  loop
    select * into b from public.boards where id = r.board_id;
    if found then perform private.crawl_send(b, 'page', r.page); end if;
    delete from private.crawl_queue where board_id = r.board_id and page = r.page;
    n := n + 1;
  end loop;

  for r in
    select d.* from jsonb_each_text(lim) l(ats, cap)
    cross join lateral (
      select b2.* from public.boards b2
      where b2.ats = l.ats and b2.status in ('pending', 'active', 'empty') and b2.next_run_at <= now()
        and not exists (select 1 from private.crawl_inflight f where f.board_id = b2.id)
        and not exists (select 1 from private.crawl_wd w where w.board_id = b2.id)
      order by b2.next_run_at
      limit l.cap::int) d
  loop
    b := r;
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
