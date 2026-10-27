-- AI usage metering (applied via the Supabase connector as migration "ai_usage_1_meter", 27 Oct 2026). Kept here for reference.
-- private.ai_usage        one row per request to an AI provider (written in batches by src/lib/ai.ts)
-- private.ai_usage_daily  per-day rollup of rows older than the raw-row retention window (see 02_retention.sql)
-- public.ai_usage_log     batch insert, guarded by the ingest secret (server only)
-- public.admin_ai_usage / admin_ai_usage_rows / admin_ai_user_costs   aggregates, admins only (is_admin())

create table if not exists private.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  task_id uuid,
  provider text not null,
  model text not null,
  feature text not null default 'other',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  thinking_tokens integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  latency_ms integer,
  ok boolean not null default true,
  http_status smallint,
  error text
);
create index if not exists ai_usage_created_idx on private.ai_usage (created_at);
create index if not exists ai_usage_user_created_idx on private.ai_usage (user_id, created_at);
alter table private.ai_usage enable row level security;
revoke all on private.ai_usage from public, anon, authenticated;

create table if not exists private.ai_usage_daily (
  day date not null,
  user_id uuid not null default '00000000-0000-0000-0000-000000000000',
  feature text not null,
  provider text not null,
  model text not null,
  calls integer not null default 0,
  failures integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  thinking_tokens bigint not null default 0,
  cost_usd numeric(14,6) not null default 0,
  primary key (day, user_id, feature, provider, model)
);
alter table private.ai_usage_daily enable row level security;
revoke all on private.ai_usage_daily from public, anon, authenticated;

-- Small safe casts so one bad value never fails a whole batch.
create or replace function private.ai_int(v text) returns integer
language sql immutable as $$
  select case when v ~ '^\d{1,10}$' then least(v::bigint, 2000000000)::int else 0 end
$$;
create or replace function private.ai_uuid(v text) returns uuid
language sql immutable as $$
  select case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end
$$;
revoke all on function private.ai_int(text), private.ai_uuid(text) from public;

create or replace function public.ai_usage_log(secret text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare n int;
begin
  perform private.check_secret(secret);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  insert into private.ai_usage (created_at, user_id, task_id, provider, model, feature, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, thinking_tokens, cost_usd, latency_ms, ok, http_status, error)
  select
    now() - make_interval(secs => (least(private.ai_int(r->>'ms_ago'), 3600000) / 1000.0)::double precision),
    private.ai_uuid(r->>'user_id'),
    private.ai_uuid(r->>'task_id'),
    left(coalesce(nullif(r->>'provider', ''), 'unknown'), 20),
    left(coalesce(nullif(r->>'model', ''), 'unknown'), 80),
    left(coalesce(nullif(r->>'feature', ''), 'other'), 40),
    private.ai_int(r->>'input'),
    private.ai_int(r->>'output'),
    private.ai_int(r->>'cache_read'),
    private.ai_int(r->>'cache_write'),
    private.ai_int(r->>'thinking'),
    case when r->>'cost' ~ '^\d{1,6}(\.\d+)?([eE]-?\d+)?$' then least((r->>'cost')::numeric, 100000)::numeric(12,6) else 0 end,
    private.ai_int(r->>'latency_ms'),
    coalesce((r->>'ok')::boolean, true),
    case when r->>'status' ~ '^\d{1,3}$' then (r->>'status')::smallint end,
    left(r->>'error', 200)
  from (select value as r from jsonb_array_elements(p_rows) limit 500) x
  where jsonb_typeof(r) = 'object';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ai_usage_log(text, jsonb) from public;
grant execute on function public.ai_usage_log(text, jsonb) to anon, authenticated, service_role;

-- Everything the admin "AI spend" page shows for one date range, in one call.
create or replace function public.admin_ai_usage(p_from timestamptz default null, p_to timestamptz default null, p_tz text default 'UTC')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  tz text := 'UTC';
  f timestamptz;
  t timestamptz;
  today0 timestamptz;
  month0 timestamptz;
  month1 timestamptz;
  result jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  begin
    perform now() at time zone p_tz;
    tz := coalesce(nullif(p_tz, ''), 'UTC');
  exception when others then tz := 'UTC';
  end;
  t := coalesce(p_to, now());
  f := coalesce(p_from, t - interval '30 days');
  if f > t then f := t - interval '1 day'; end if;
  if t - f > interval '400 days' then f := t - interval '400 days'; end if;
  today0 := date_trunc('day', now() at time zone tz) at time zone tz;
  month0 := date_trunc('month', now() at time zone tz) at time zone tz;
  month1 := (date_trunc('month', now() at time zone tz) + interval '1 month') at time zone tz;

  with r as (
    select * from private.ai_usage where created_at >= f and created_at < t
  ),
  subs as (
    select user_id, coalesce(finished_at, updated_at) as sub_at from public.agent_tasks
    where status = 'submitted' and coalesce(finished_at, updated_at) >= f and coalesce(finished_at, updated_at) < t
  ),
  totals as (
    select count(*)::int as calls,
      count(*) filter (where not ok)::int as failures,
      coalesce(sum(input_tokens), 0)::bigint as input,
      coalesce(sum(output_tokens), 0)::bigint as output,
      coalesce(sum(cache_read_tokens), 0)::bigint as cache_read,
      coalesce(sum(cache_write_tokens), 0)::bigint as cache_write,
      coalesce(sum(thinking_tokens), 0)::bigint as thinking,
      coalesce(sum(cost_usd), 0)::numeric(14,6) as cost,
      count(distinct user_id)::int as users,
      round(avg(latency_ms) filter (where ok))::int as avg_latency_ms,
      (percentile_cont(0.95) within group (order by latency_ms) filter (where ok))::int as p95_latency_ms,
      count(*) filter (where user_id is null)::int as unattributed_calls,
      coalesce(sum(cost_usd) filter (where user_id is null), 0)::numeric(14,6) as unattributed_cost,
      (select count(*) from subs)::int as submitted
    from r
  ),
  days as (
    select d::date as day from generate_series((f at time zone tz)::date, ((t - interval '1 microsecond') at time zone tz)::date, interval '1 day') d
  ),
  by_day as (
    select d.day,
      coalesce(x.calls, 0) as calls, coalesce(x.failures, 0) as failures, coalesce(x.tokens, 0) as tokens,
      coalesce(x.cost, 0) as cost, coalesce(s.n, 0) as submitted
    from days d
    left join (
      select (created_at at time zone tz)::date as day, count(*)::int as calls, count(*) filter (where not ok)::int as failures,
        sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + thinking_tokens)::bigint as tokens,
        sum(cost_usd)::numeric(14,6) as cost
      from r group by 1
    ) x on x.day = d.day
    left join (select (sub_at at time zone tz)::date as day, count(*)::int as n from subs group by 1) s on s.day = d.day
    order by d.day
  ),
  by_feature as (
    select feature, count(*)::int as calls, count(*) filter (where not ok)::int as failures,
      sum(input_tokens + cache_read_tokens + cache_write_tokens)::bigint as input, sum(output_tokens + thinking_tokens)::bigint as output,
      sum(cost_usd)::numeric(14,6) as cost, round(avg(latency_ms) filter (where ok))::int as avg_latency_ms, count(distinct user_id)::int as users
    from r group by 1 order by sum(cost_usd) desc, count(*) desc
  ),
  by_model as (
    select provider, model, count(*)::int as calls, count(*) filter (where not ok)::int as failures,
      sum(input_tokens)::bigint as input, sum(output_tokens)::bigint as output, sum(cache_read_tokens)::bigint as cache_read,
      sum(cache_write_tokens)::bigint as cache_write, sum(thinking_tokens)::bigint as thinking,
      sum(cost_usd)::numeric(14,6) as cost, round(avg(latency_ms) filter (where ok))::int as avg_latency_ms
    from r group by 1, 2 order by sum(cost_usd) desc, count(*) desc
  ),
  u_usage as (
    select user_id, count(*)::int as calls, count(*) filter (where not ok)::int as failures,
      sum(input_tokens + cache_read_tokens + cache_write_tokens)::bigint as input, sum(output_tokens + thinking_tokens)::bigint as output,
      sum(cost_usd)::numeric(14,6) as cost, max(created_at) as last_at,
      mode() within group (order by feature) as top_feature
    from r where user_id is not null group by 1
  ),
  u_subs as (select user_id, count(*)::int as n from subs group by 1),
  by_user as (
    select coalesce(u.user_id, s.user_id) as user_id, p.email, p.full_name,
      coalesce(u.calls, 0) as calls, coalesce(u.failures, 0) as failures, coalesce(u.input, 0) as input, coalesce(u.output, 0) as output,
      coalesce(u.cost, 0) as cost, u.last_at, u.top_feature, coalesce(s.n, 0) as submitted
    from u_usage u full join u_subs s on s.user_id = u.user_id
    left join public.profiles p on p.id = coalesce(u.user_id, s.user_id)
    order by coalesce(u.cost, 0) desc, coalesce(s.n, 0) desc
    limit 2000
  ),
  months as (
    select to_char(m, 'YYYY-MM') as month, sum(cost)::numeric(14,6) as cost, sum(calls)::int as calls from (
      select date_trunc('month', created_at at time zone tz) as m, cost_usd as cost, 1 as calls
      from private.ai_usage where created_at >= date_trunc('month', now() at time zone tz) at time zone tz - interval '11 months'
      union all
      select date_trunc('month', day::timestamp), cost_usd, calls from private.ai_usage_daily
      where day >= (date_trunc('month', now() at time zone tz) - interval '11 months')::date
    ) z group by 1 order by 1
  ),
  kpi as (
    select
      coalesce(sum(cost_usd) filter (where created_at >= today0), 0)::numeric(14,6) as today,
      count(*) filter (where created_at >= today0)::int as calls_today,
      coalesce(sum(cost_usd) filter (where created_at >= now() - interval '7 days'), 0)::numeric(14,6) as d7,
      coalesce(sum(cost_usd) filter (where created_at >= now() - interval '30 days'), 0)::numeric(14,6) as d30,
      coalesce(sum(cost_usd) filter (where created_at >= month0), 0)::numeric(14,6) as mtd,
      coalesce(sum(cost_usd) filter (where created_at >= month0 - interval '1 month' and created_at < month0), 0)::numeric(14,6)
        + coalesce((select sum(cost_usd) from private.ai_usage_daily where day >= ((month0 - interval '1 month') at time zone tz)::date and day < (month0 at time zone tz)::date), 0) as prev_month,
      count(distinct user_id) filter (where created_at >= now() - interval '30 days')::int as users_30d
    from private.ai_usage where created_at >= least(month0 - interval '1 month', now() - interval '30 days')
  )
  select jsonb_build_object(
    'from', f, 'to', t, 'tz', tz, 'now', now(),
    'month_start', month0, 'month_end', month1,
    'first_at', (select min(created_at) from private.ai_usage),
    'totals', (select to_jsonb(totals) from totals),
    'kpi', (select to_jsonb(kpi) || jsonb_build_object(
      'submitted_30d', (select count(*) from public.agent_tasks where status = 'submitted' and coalesce(finished_at, updated_at) >= now() - interval '30 days'),
      'submitted_mtd', (select count(*) from public.agent_tasks where status = 'submitted' and coalesce(finished_at, updated_at) >= month0)
    ) from kpi),
    'by_day', coalesce((select jsonb_agg(to_jsonb(by_day)) from by_day), '[]'::jsonb),
    'by_feature', coalesce((select jsonb_agg(to_jsonb(by_feature)) from by_feature), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(to_jsonb(by_model)) from by_model), '[]'::jsonb),
    'by_user', coalesce((select jsonb_agg(to_jsonb(by_user)) from by_user), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(to_jsonb(months)) from months), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_ai_usage(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_ai_usage(timestamptz, timestamptz, text) to authenticated;

-- CSV export: one row per day × user × feature × model in the range.
create or replace function public.admin_ai_usage_rows(p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns table(day date, user_id uuid, email text, full_name text, feature text, provider text, model text, calls integer, failures integer,
  input_tokens bigint, output_tokens bigint, cache_read_tokens bigint, cache_write_tokens bigint, thinking_tokens bigint, cost_usd numeric, avg_latency_ms integer)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare tz text := 'UTC';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  begin
    perform now() at time zone p_tz;
    tz := coalesce(nullif(p_tz, ''), 'UTC');
  exception when others then tz := 'UTC';
  end;
  return query
  select (a.created_at at time zone tz)::date, a.user_id, p.email, p.full_name, a.feature, a.provider, a.model,
    count(*)::int, count(*) filter (where not a.ok)::int,
    sum(a.input_tokens)::bigint, sum(a.output_tokens)::bigint, sum(a.cache_read_tokens)::bigint, sum(a.cache_write_tokens)::bigint, sum(a.thinking_tokens)::bigint,
    sum(a.cost_usd)::numeric(14,6), round(avg(a.latency_ms) filter (where a.ok))::int
  from private.ai_usage a left join public.profiles p on p.id = a.user_id
  where a.created_at >= coalesce(p_from, now() - interval '30 days') and a.created_at < coalesce(p_to, now())
  group by 1, 2, 3, 4, 5, 6, 7
  order by 1, sum(a.cost_usd) desc
  limit 100000;
end $$;
revoke all on function public.admin_ai_usage_rows(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_ai_usage_rows(timestamptz, timestamptz, text) to authenticated;

-- Per-user AI cost for the admin users list.
create or replace function public.admin_ai_user_costs()
returns table(user_id uuid, cost_30d numeric, calls_30d integer, cost_total numeric, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select x.user_id, sum(x.c30)::numeric(14,6), sum(x.n30)::int, sum(x.c)::numeric(14,6), max(x.last_at) from (
    select a.user_id, a.cost_usd as c, case when a.created_at >= now() - interval '30 days' then a.cost_usd else 0 end as c30,
      case when a.created_at >= now() - interval '30 days' then 1 else 0 end as n30, a.created_at as last_at
    from private.ai_usage a where a.user_id is not null
    union all
    select d.user_id, d.cost_usd, 0, 0, null from private.ai_usage_daily d where d.user_id <> '00000000-0000-0000-0000-000000000000'
  ) x group by x.user_id;
end $$;
revoke all on function public.admin_ai_user_costs() from public, anon;
grant execute on function public.admin_ai_user_costs() to authenticated;
