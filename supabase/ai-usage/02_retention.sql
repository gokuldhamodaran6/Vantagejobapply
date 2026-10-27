-- AI usage retention — NOT APPLIED YET (the migration tool declined it because it contains a DELETE).
-- Run this whole file once in the Supabase SQL editor (project fplxzhjjribmscduypoj). Safe to re-run.
-- Raw rows are kept 180 days. Each night, rows older than that are first added to private.ai_usage_daily
-- (per day × user × feature × model, so monthly history and per-user totals survive), then removed.
-- Only rows older than the cutoff are ever touched.

create or replace function private.ai_usage_retention(p_keep_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  cutoff timestamptz := date_trunc('day', (now() at time zone 'UTC') - make_interval(days => greatest(coalesce(p_keep_days, 180), 30))) at time zone 'UTC';
  n int;
begin
  insert into private.ai_usage_daily as d (day, user_id, feature, provider, model, calls, failures,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, thinking_tokens, cost_usd)
  select (created_at at time zone 'UTC')::date, coalesce(user_id, '00000000-0000-0000-0000-000000000000'), feature, provider, model,
    count(*), count(*) filter (where not ok), sum(input_tokens), sum(output_tokens), sum(cache_read_tokens),
    sum(cache_write_tokens), sum(thinking_tokens), sum(cost_usd)
  from private.ai_usage where created_at < cutoff
  group by 1, 2, 3, 4, 5
  on conflict (day, user_id, feature, provider, model) do update set
    calls = d.calls + excluded.calls, failures = d.failures + excluded.failures,
    input_tokens = d.input_tokens + excluded.input_tokens, output_tokens = d.output_tokens + excluded.output_tokens,
    cache_read_tokens = d.cache_read_tokens + excluded.cache_read_tokens, cache_write_tokens = d.cache_write_tokens + excluded.cache_write_tokens,
    thinking_tokens = d.thinking_tokens + excluded.thinking_tokens, cost_usd = d.cost_usd + excluded.cost_usd;

  delete from private.ai_usage where created_at < cutoff;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.ai_usage_retention(integer) from public, anon, authenticated;

select cron.schedule('vantage-ai-usage-retention', '50 5 * * *', 'select private.ai_usage_retention()');
