-- System health (applied as health_01). One snapshot of everything that can quietly stop — the agent queue, scheduled
-- jobs, the job crawl, mailbox sync, AI calls — plus alerts that open when something stops and close when it recovers.
-- A new alert asks the app to send the admin an email (when an email service is configured).

create table if not exists private.health_alerts (
  key text primary key,
  message text not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz
);

create or replace function private.health_snapshot() returns jsonb
language sql stable security definer set search_path = public, private, cron as $$
  select jsonb_build_object(
    'at', now(),
    'queue', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.agent_tasks
               where status in ('queued','running','waiting_code','needs_human','needs_user','awaiting_approval') group by 1) x),
    'oldest_queued_min', (select round(extract(epoch from now() - min(updated_at)) / 60) from public.agent_tasks where status = 'queued'
                           and coalesce(step, '') not like 'Waiting for tomorrow%'),
    'stuck_running', (select count(*) from public.agent_tasks where status = 'running' and updated_at < now() - interval '20 minutes'),
    'last_24h', (select jsonb_build_object(
        'submitted', count(*) filter (where status = 'submitted'),
        'failed', count(*) filter (where status = 'failed'),
        'manual', count(*) filter (where status = 'manual'),
        'needs_you', count(*) filter (where status in ('needs_user','needs_human','awaiting_approval')))
      from public.agent_tasks where updated_at > now() - interval '24 hours' and mode <> 'dry_run'),
    'top_errors', (select coalesce(jsonb_agg(jsonb_build_object('error', e, 'n', n) order by n desc), '[]'::jsonb) from (
        select left(regexp_replace(coalesce(error, step, ''), '\s+', ' ', 'g'), 140) e, count(*) n from public.agent_tasks
         where status in ('failed','manual') and updated_at > now() - interval '24 hours' and mode <> 'dry_run' group by 1 order by 2 desc limit 6) x),
    'cron', (select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'active', j.active, 'status', d.status, 'at', d.start_time,
              'fails_24h', (select count(*) from cron.job_run_details r where r.jobid = j.jobid and r.status = 'failed' and r.start_time > now() - interval '24 hours'),
              'message', left(d.return_message, 160)) order by j.jobname), '[]'::jsonb)
             from cron.job j left join lateral (select status, start_time, return_message from cron.job_run_details r where r.jobid = j.jobid
               and r.status <> 'running' order by start_time desc limit 1) d on true),
    'crawl', (select jsonb_build_object('stats_at', (select updated_at from private.crawl_stats where id = 1),
              'open_jobs', (select open_jobs from private.crawl_stats where id = 1),
              'last_board_ok', (select max(last_ok_at) from public.boards),
              'boards_ok_1h', (select count(*) from public.boards where last_ok_at > now() - interval '1 hour'),
              'boards_failing', (select count(*) from public.boards where status = 'active' and coalesce(fail_count, 0) >= 3))),
    'mail', (select jsonb_build_object('active', count(*) filter (where status = 'active'),
              'errors', count(*) filter (where status = 'error'),
              'stale', count(*) filter (where status = 'active' and (last_sync_at is null or last_sync_at < now() - interval '60 minutes')))
             from public.mail_accounts),
    'ai_1h', (select jsonb_build_object('calls', count(*), 'failed', count(*) filter (where not ok),
              'last_error', (select left(error, 160) from private.ai_usage where not ok and created_at > now() - interval '1 hour' order by created_at desc limit 1))
             from private.ai_usage where created_at > now() - interval '1 hour'),
    'blocked_sites', (select count(*) from public.site_blocks where expires_at is null or expires_at > now()),
    'alerts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.first_at desc), '[]'::jsonb) from private.health_alerts a
               where a.resolved_at is null or a.resolved_at > now() - interval '24 hours')
  )
$$;
revoke all on function private.health_snapshot() from public, anon, authenticated;

-- For the admin page (signed in as an admin).
create or replace function public.admin_health() returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return private.health_snapshot();
end $$;
revoke all on function public.admin_health() from public, anon;
grant execute on function public.admin_health() to authenticated;

-- Every 10 minutes: what has stopped? Opens alerts, closes recovered ones, and asks the app to email new ones.
create or replace function private.health_check() returns jsonb
language plpgsql security definer set search_path = public, private, cron as $$
declare
  s jsonb := private.health_snapshot();
  problems jsonb := '{}'::jsonb;
  c jsonb;
  fresh jsonb;
begin
  -- Scheduled jobs whose last run failed and that failed at least 3 times today.
  for c in select * from jsonb_array_elements(s->'cron') loop
    if (c->>'active')::boolean and c->>'status' = 'failed' and (c->>'fails_24h')::int >= 3 then
      problems := problems || jsonb_build_object('cron:' || (c->>'job'), 'Scheduled job "' || (c->>'job') || '" keeps failing: ' || coalesce(c->>'message', 'no message'));
    end if;
  end loop;
  if coalesce((s->>'oldest_queued_min')::int, 0) >= 30 and coalesce((s->'queue'->>'running')::int, 0) = 0 then
    problems := problems || jsonb_build_object('queue', 'Applications have waited ' || (s->>'oldest_queued_min') || ' minutes and nothing is running — the agent worker may be down.');
  end if;
  if coalesce((s->>'stuck_running')::int, 0) > 0 then
    problems := problems || jsonb_build_object('stuck', (s->>'stuck_running') || ' application run(s) haven''t moved for 20+ minutes.');
  end if;
  if (select count(*) from public.agent_tasks where updated_at > now() - interval '6 hours' and mode <> 'dry_run' and status in ('submitted','failed','manual')) >= 6
     and (select count(*) filter (where status = 'failed')::float / greatest(count(*), 1) from public.agent_tasks
          where updated_at > now() - interval '6 hours' and mode <> 'dry_run' and status in ('submitted','failed','manual')) >= 0.5 then
    problems := problems || jsonb_build_object('failures', 'Half or more of the agent''s runs in the last 6 hours failed. Top reason: ' || coalesce(s->'top_errors'->0->>'error', 'unknown'));
  end if;
  if (s->'crawl'->>'stats_at')::timestamptz < now() - interval '45 minutes' then
    problems := problems || jsonb_build_object('crawl_stats', 'Job counts haven''t refreshed since ' || to_char((s->'crawl'->>'stats_at')::timestamptz, 'Mon DD HH24:MI') || ' UTC.');
  end if;
  if (s->'crawl'->>'last_board_ok')::timestamptz < now() - interval '2 hours' then
    problems := problems || jsonb_build_object('crawl', 'No company job feed has been read for 2+ hours — the job crawl may have stopped.');
  end if;
  if coalesce((s->'mail'->>'stale')::int, 0) > 0 then
    problems := problems || jsonb_build_object('mail', (s->'mail'->>'stale') || ' job mailbox(es) haven''t synced for an hour — security codes may be missed.');
  end if;
  if coalesce((s->'ai_1h'->>'calls')::int, 0) >= 5 and (s->'ai_1h'->>'failed')::float / greatest((s->'ai_1h'->>'calls')::int, 1) >= 0.5 then
    problems := problems || jsonb_build_object('ai', 'Half or more AI calls failed in the last hour: ' || coalesce(s->'ai_1h'->>'last_error', 'unknown'));
  end if;

  -- Open new / refresh ongoing.
  insert into private.health_alerts as a (key, message)
  select key, value #>> '{}' from jsonb_each(problems)
  on conflict (key) do update set message = excluded.message, last_at = now(),
    first_at = case when a.resolved_at is not null then now() else a.first_at end,
    notified_at = case when a.resolved_at is not null then null else a.notified_at end,
    resolved_at = null;
  -- Close recovered.
  update private.health_alerts set resolved_at = now() where resolved_at is null and not (problems ? key);

  -- Email new alerts once (the app sends it, when an email service is configured).
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'message', message)), '[]'::jsonb) into fresh
    from private.health_alerts where resolved_at is null and notified_at is null;
  if jsonb_array_length(fresh) > 0 then
    update private.health_alerts set notified_at = now() where resolved_at is null and notified_at is null;
    perform net.http_post(
      url := (select value from private.config where key = 'site_url') || '/api/cron/ingest?task=health_alert',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from private.config where key = 'ingest_secret')),
      body := jsonb_build_object('alerts', fresh), timeout_milliseconds := 30000);
  end if;
  return problems;
end $$;
revoke all on function private.health_check() from public, anon, authenticated;

select cron.schedule('vantage-health', '*/10 * * * *', 'select private.health_check()');
