-- Vantage job crawler, part 4: lean storage.
-- Each job is a small card (title, company, place, dates, link, salary, visa flags) plus a short
-- requirements summary. Visa and eligibility signals are worked out from the full text while it is
-- read, then the full text is dropped; it is fetched live from the employer only when someone opens
-- the job or tailors a resume, and kept 30 days. Only countries users target are stored. Closed jobs
-- are deleted after 7 days, leaving a tiny fingerprint so reposts are still recognised for 120 days.

alter table public.jobs add column if not exists desc_len int;

create table if not exists private.job_fp (
  board_id bigint not null,
  title_norm text not null,
  country text not null,
  first_seen_at timestamptz not null,
  closed_at timestamptz not null,
  reposts int not null default 0,
  primary key (board_id, title_norm, country)
);

create table if not exists private.job_text (
  job_id text primary key,
  body text not null,
  fetched_at timestamptz not null default now()
);

-- Keep the lines that matter for matching (skills, experience, requirements, visa, pay) up to ~2,000 characters.
create or replace function private.req_excerpt(t text, maxlen int default 2000) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  parts text[];
  p text;
  out text := '';
  keep text := '(experience|years|skill|require|qualif|proficien|knowledge|familiar|degree|bachelor|master|phd|must|ability|able to|you have|you will|you''ll|looking for|responsib|sponsor|visa|authori[sz]|citizen|clearance|remote|hybrid|on-?site|in-office|salary|compensation|pay range|base pay|\$ ?[0-9]|£ ?[0-9]|€ ?[0-9]|python|sql|excel|figma|java|react|aws)';
begin
  if t is null or length(t) <= maxlen then return t; end if;
  parts := regexp_split_to_array(t, E'\n+');
  if array_length(parts, 1) < 6 then parts := regexp_split_to_array(t, E'(?:\\.|;)\\s+'); end if;
  foreach p in array parts loop
    p := btrim(p);
    continue when length(p) < 3;
    if p ~* keep and length(out) + length(p) + 1 <= maxlen then
      out := out || p || E'\n';
    end if;
  end loop;
  if length(out) < maxlen / 3 then return left(t, maxlen); end if;
  return rtrim(out, E'\n');
end $$;

-- Countries anyone on Vantage is looking in (the US is always included for new accounts).
create or replace function private.demand_countries() returns text[]
language sql stable set search_path = public, private as $$
  select coalesce(array_agg(distinct upper(c)), '{}'::text[]) || array['US']
  from public.target_prefs t, unnest(coalesce(t.countries, '{}'::text[])) c
$$;

-- When someone adds a new country, re-read every board (spread over 6 hours) so its jobs come in.
create or replace function private.on_target_countries() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare added text[];
begin
  select array_agg(c) into added from unnest(coalesce(new.countries, '{}'::text[])) c
  where upper(c) <> 'US' and not exists (
    select 1 from public.target_prefs t, unnest(coalesce(t.countries, '{}'::text[])) c2
    where t.user_id <> new.user_id and upper(c2) = upper(c))
    and not (upper(c) = any (select upper(x) from unnest(case when tg_op = 'UPDATE' then coalesce(old.countries, '{}'::text[]) else '{}'::text[] end) x));
  if added is not null then
    update public.boards set sig = null, next_run_at = least(next_run_at, now() + make_interval(secs => floor(random() * 21600)::int))
    where status in ('active', 'empty');
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'target_countries_crawl' and tgrelid = 'public.target_prefs'::regclass) then
    create trigger target_countries_crawl after insert or update of countries on public.target_prefs
      for each row execute function private.on_target_countries();
  end if;
end $$;

-- Ingest, lean version: only demanded countries, nothing older than 120 days, summary instead of full text.
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
  demand text[] := private.demand_countries();
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
    where s.country = any (demand)
      and (s.posted is null or s.posted > now() - interval '120 days')
  ), todo as (
    select h.* from h
    where not exists (select 1 from public.jobs j where j.id = h.id and j.hash = h.hash and j.closed_at is null)
  ), ins as (
    insert into public.jobs as j (id, source, country, title, company, company_norm, location, remote, description, desc_len, url,
      salary_min, salary_max, currency, category, contract_time, posted_at, fetched_at, sponsorship, sponsor_registered,
      restrictions, board_id, hash, first_seen_at, repost_of, reposts, closed_at)
    select t.id, b.ats, t.country, t.title, b.name, public.norm_company(b.name), t.location,
      t.remote_flag or sig.remote or coalesce(t.location, '') ~* '\yremote\y|anywhere|work from home',
      private.req_excerpt(t.descr), length(t.descr), t.url, t.smin, t.smax, t.cur, b.industry, t.contract,
      coalesce(t.posted, now()), now(), sig.sponsorship,
      exists (select 1 from public.sponsors s where s.country = t.country and s.name_norm = public.norm_company(b.name)),
      sig.restrictions, b.id, t.hash, coalesce(rp.first_seen_at, now()), rp.id, coalesce(rp.reposts + 1, 0), null
    from todo t
    cross join lateral private.job_signals(t.title, t.descr) sig
    left join lateral (
      select u.id, u.first_seen_at, u.reposts from (
        select r.id, r.first_seen_at, r.reposts from public.jobs r
        where r.board_id = b.id and r.title_norm = private.title_norm(t.title) and r.country = t.country and r.id <> t.id
          and r.closed_at is not null and r.closed_at > now() - interval '120 days'
        union all
        select null::text, f.first_seen_at, f.reposts from private.job_fp f
        where f.board_id = b.id and f.title_norm = private.title_norm(t.title) and f.country = t.country
          and f.closed_at > now() - interval '120 days') u
      order by u.first_seen_at limit 1) rp on true
    on conflict (id) do update set
      title = excluded.title, company = excluded.company, company_norm = excluded.company_norm,
      location = excluded.location, country = excluded.country, remote = excluded.remote,
      description = coalesce(excluded.description, j.description), desc_len = coalesce(excluded.desc_len, j.desc_len),
      url = excluded.url, salary_min = excluded.salary_min, salary_max = excluded.salary_max, currency = excluded.currency,
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
      held := true;
    elsif prev_open >= 20 and n_items < prev_open * 0.3 and coalesce(b.last_error, '') <> 'shrunk' then
      held := true;
    else
      update public.jobs set closed_at = now()
      where board_id = b.id and closed_at is null and id <> all (coalesce(ids, '{}'::text[]));
      get diagnostics n_closed = row_count;
    end if;
  else
    update public.jobs set seen_at = now() where id = any (coalesce(ids, '{}'::text[])) and closed_at is null;
    update public.jobs set closed_at = now()
    where board_id = b.id and closed_at is null and coalesce(seen_at, first_seen_at) < now() - interval '3 days';
    get diagnostics n_closed = row_count;
  end if;

  return jsonb_build_object('items', n_items, 'new', n_new, 'updated', n_upd, 'closed', n_closed, 'held', held,
    'changed', (n_new + n_upd + n_closed) > 0);
end $$;

-- Full job text, fetched live from the employer by the app and kept 30 days.
create or replace function public.job_text(secret text, op text, p_id text, p_body text default null)
returns text language plpgsql security definer set search_path = public, private as $$
declare t text;
begin
  perform private.check_secret(secret);
  if op = 'get' then
    select body into t from private.job_text where job_id = p_id and fetched_at > now() - interval '30 days';
    return t;
  elsif op = 'put' and coalesce(p_body, '') <> '' then
    insert into private.job_text (job_id, body) values (p_id, left(p_body, 30000))
    on conflict (job_id) do update set body = excluded.body, fetched_at = now();
    return 'ok';
  end if;
  return null;
end $$;
