-- When auto-apply runs: null = through the day (every 10 minutes); otherwise set times in the person's own time zone
-- and optional quiet hours. Example: {"tz":"America/Chicago","times":["08:30","12:30","18:30"],"quiet":{"from":22,"to":7}}
alter table public.profiles add column if not exists auto_schedule jsonb;

create or replace function public.agent_limits(secret text, p_user uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
begin
  perform private.check_secret(secret);
  return jsonb_build_object(
    'daily_limit', (select daily_limit from public.profiles where id = p_user),
    'high_volume_ok', (select high_volume_ok from public.profiles where id = p_user),
    'schedule', (select auto_schedule from public.profiles where id = p_user),
    'employers', coalesce((select jsonb_object_agg(co, n) from (
      select public.norm_company(t.job ->> 'company') co, count(*) n from public.agent_tasks t
      where t.user_id = p_user and t.created_at > now() - interval '30 days'
        and t.status in ('submitted', 'queued', 'running', 'waiting_code', 'needs_human', 'needs_user', 'awaiting_approval')
      group by 1) x), '{}'::jsonb));
end $function$;

-- (applied as auto_schedule_02_limits_today) agent_limits also returns 'today': the agent's applications started since
-- midnight UTC plus the ones in line — used by "Send to my Vantage list" in the extension.
