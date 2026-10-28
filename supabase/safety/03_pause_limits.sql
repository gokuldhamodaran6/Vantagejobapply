-- Safe updates and limits the database keeps (applied as safety_03_pause_limits).
--  * pause: a worker that is shutting down for an update puts its run back in line (attempt not counted) unless Submit
--    was already pressed — then it is never retried.
--  * claim: the daily limit is enforced here too (jobs over it wait for tomorrow, with a clear step), and a 4th
--    application to the same company within 30 days is never started. Dry runs (admin release checks) are exempt.

create or replace function private.daily_cap(p_user uuid) returns int
language sql stable security definer set search_path = public, private as $$
  select greatest(0, least(coalesce(p.daily_limit, 20),
           case when p.high_volume_ok then case when p.role = 'admin' then 500 else 200 end else 20 end))
    from public.profiles p where p.id = p_user
$$;

create or replace function private.under_daily(p_user uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select (select count(*) from public.agent_tasks a
           where a.user_id = p_user and a.started_at >= date_trunc('day', now()) and a.mode <> 'dry_run' and a.status <> 'extension')
         < coalesce(private.daily_cap(p_user), 20)
$$;

create or replace function private.employer_sent_30d(p_user uuid, p_task uuid, p_company text) returns int
language sql stable security definer set search_path = public, private as $$
  select count(*)::int from public.agent_tasks a
   where a.user_id = p_user and a.id <> p_task and a.mode <> 'dry_run' and a.created_at > now() - interval '30 days'
     and (a.status in ('submitted','running','waiting_code','needs_human') or a.submit_clicked_at is not null)
     and private.co_key(a.job->>'company') = private.co_key(p_company)
$$;

revoke all on function private.daily_cap(uuid) from public, anon, authenticated;
revoke all on function private.under_daily(uuid) from public, anon, authenticated;
revoke all on function private.employer_sent_30d(uuid, uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_rpc(secret text, op text, args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  t public.agent_tasks;
  uid uuid;
  out jsonb;
  n int;
  why text;
begin
  perform private.check_secret(secret);

  if op = 'claim' then
    -- Requeue tasks whose worker died — unless the final Submit may already have been pressed.
    update public.agent_tasks set status = 'manual', locked_at = null, finished_at = now(),
        error = 'The run stopped right after pressing Submit. Check your job email for a confirmation before trying again.'
      where status in ('running','waiting_code') and locked_at < now() - interval '15 minutes' and submit_clicked_at is not null;
    update public.agent_tasks set status = 'queued', locked_at = null, step = 'Retrying after an interruption'
      where status in ('running','waiting_code') and locked_at < now() - interval '15 minutes' and attempts < 3;
    update public.agent_tasks set status = 'failed', error = coalesce(error, 'Stopped after 3 attempts'), finished_at = now()
      where status in ('running','waiting_code') and locked_at < now() - interval '15 minutes' and attempts >= 3;
    -- A human check whose worker vanished doesn't hold the line forever.
    update public.agent_tasks set status = 'manual', finished_at = now(), error = 'The human check expired — open the job to finish it'
      where status = 'needs_human' and updated_at < now() - interval '30 minutes';
    -- Daily limit, checked here too (not only when jobs are lined up): over it, jobs wait for tomorrow and say so.
    update public.agent_tasks q set step = 'Waiting for tomorrow — today''s limit of ' || private.daily_cap(q.user_id) || ' is reached'
      where q.status = 'queued' and q.mode <> 'dry_run' and not private.under_daily(q.user_id)
        and q.step is distinct from 'Waiting for tomorrow — today''s limit of ' || private.daily_cap(q.user_id) || ' is reached';
    loop
      select * into t from public.agent_tasks
        where status = 'queued' and (mode = 'dry_run' or private.under_daily(user_id))
        order by priority asc, created_at asc
        for update skip locked limit 1;
      if not found then return null; end if;
      why := case when t.submit_clicked_at is not null then 'An earlier run may already have submitted this job — check your email for a confirmation'
                  else private.apply_block(t.user_id, t.id, t.job_id, t.job->>'company', t.job->>'title') end;
      -- Never a 4th application to the same company in 30 days, however the job got into the line.
      if why is null and t.mode <> 'dry_run' and private.employer_sent_30d(t.user_id, t.id, t.job->>'company') >= 3 then
        update public.agent_tasks set status = 'manual', locked_at = null, finished_at = now(),
          step = 'Not sent — 3 applications to ' || coalesce(t.job->>'company', 'this company') || ' in 30 days already',
          error = 'Your agent already sent 3 applications to ' || coalesce(t.job->>'company', 'this company') || ' in the last 30 days, so it stops there. Apply to this one yourself if it fits best — the Chrome extension fills it while you press Submit.',
          log = log || jsonb_build_array(jsonb_build_object('at', now(), 'text', 'Not sent: 3 applications to this company in 30 days'))
          where id = t.id;
        continue;
      end if;
      exit when why is null;
      update public.agent_tasks set status = 'cancelled', cancel_reason = 'duplicate', step = 'Skipped — ' || why, finished_at = now(), locked_at = null,
        log = log || jsonb_build_array(jsonb_build_object('at', now(), 'text', 'Not sent: ' || why))
        where id = t.id;
    end loop;
    update public.agent_tasks set status = 'running', locked_at = now(), attempts = attempts + 1,
      started_at = coalesce(started_at, now()), step = 'Opening the application', error = null
      where id = t.id returning * into t;
    return to_jsonb(t);

  elsif op = 'task' then
    select * into t from public.agent_tasks where id = (args->>'task_id')::uuid;
    return to_jsonb(t);

  elsif op = 'bundle' then
    select * into t from public.agent_tasks where id = (args->>'task_id')::uuid;
    if not found then return null; end if;
    select jsonb_build_object(
      'task', to_jsonb(t),
      'profile', (select to_jsonb(p) - 'stripe_customer_id' from public.profiles p where p.id = t.user_id),
      'applicant', (select to_jsonb(a) from public.applicant_profiles a where a.user_id = t.user_id),
      'answers', coalesce((select jsonb_agg(jsonb_build_object('qkey', qkey, 'question', question, 'answer', answer, 'kind', kind)) from public.answer_bank b where b.user_id = t.user_id), '[]'::jsonb),
      'auth', coalesce((select jsonb_agg(to_jsonb(w)) from public.work_auth w where w.user_id = t.user_id), '[]'::jsonb),
      'resume', (select to_jsonb(r) from public.resumes r where r.id = t.resume_id and r.user_id = t.user_id),
      'master', (select to_jsonb(r) from public.resumes r where r.user_id = t.user_id and r.is_master limit 1),
      'mail', (select to_jsonb(m) - 'secret_enc' from public.mail_accounts m where m.user_id = t.user_id),
      'prefs', (select jsonb_build_object('locations', x.locations, 'remote_ok', x.remote_ok, 'countries', x.countries) from public.target_prefs x where x.user_id = t.user_id),
      'vault', coalesce((select jsonb_agg(to_jsonb(v)) from public.vault_credentials v where v.user_id = t.user_id and v.host = args->>'host'), '[]'::jsonb)
    ) into out;
    return out;

  elsif op = 'update' then
    select * into t from public.agent_tasks where id = (args->>'task_id')::uuid;
    if not found then return null; end if;
    -- The person cancelled while the worker was busy: only a real submission may still be recorded.
    if t.status = 'cancelled' and coalesce(args->>'status', '') not in ('submitted', 'manual') and not (args ? 'proof') and not coalesce((args->>'submit_clicked')::boolean, false) then
      return to_jsonb(t);
    end if;
    update public.agent_tasks set
      status = coalesce(args->>'status', status),
      step = coalesce(args->>'step', step),
      needs = coalesce(args->'needs', needs),
      error = case when args ? 'error' then args->>'error' else error end,
      user_input = case when (args->>'clear_input')::boolean then user_input - 'code' - 'human_done' else user_input end,
      log = case when args ? 'log' then (log || jsonb_build_array(jsonb_build_object('at', now(), 'text', args->>'log')))
                 else log end,
      locked_at = case when coalesce(args->>'status', status) in ('running','waiting_code') then now() else null end,
      finished_at = case when args->>'status' in ('submitted','failed','cancelled','manual') then now() else finished_at end,
      submit_clicked_at = case when coalesce((args->>'submit_clicked')::boolean, false) then coalesce(submit_clicked_at, now()) else submit_clicked_at end,
      resume_id = coalesce((args->>'resume_id')::uuid, resume_id),
      cover_letter = coalesce(args->>'cover_letter', cover_letter),
      resume_style = coalesce(args->>'resume_style', resume_style),
      letter_tone = coalesce(args->>'letter_tone', letter_tone)
    where id = (args->>'task_id')::uuid
    returning * into t;
    if args ? 'proof' then
      insert into public.agent_proofs (task_id, user_id, image) values (t.id, t.user_id, args->>'proof')
      on conflict (task_id) do update set image = excluded.image, created_at = now();
    end if;
    return to_jsonb(t);

  elsif op = 'record_application' then
    select * into t from public.agent_tasks where id = (args->>'task_id')::uuid;
    insert into public.applications (user_id, job_id, job, target_role_id, resume_id, status, match_score, cover_letter, answers, applied_at, events, source, agent_task_id, resume_style, letter_tone)
    values (t.user_id, t.job_id, t.job, nullif(t.job->>'role_id','')::uuid, (select r.id from public.resumes r where r.id = t.resume_id and r.user_id = t.user_id), 'applied', nullif(t.job->>'match','')::int, t.cover_letter,
            coalesce(args->'answers', '{}'::jsonb), now(),
            jsonb_build_array(jsonb_build_object('at', now(), 'type', 'applied', 'text', 'Submitted on the official careers site by your agent')),
            'agent', t.id, t.resume_style, t.letter_tone)
    on conflict (user_id, job_id) do update set status = 'applied', applied_at = now(), source = 'agent', agent_task_id = t.id,
      resume_id = excluded.resume_id, cover_letter = excluded.cover_letter, resume_style = excluded.resume_style, letter_tone = excluded.letter_tone,
      events = public.applications.events || excluded.events
    returning id into uid;
    update public.agent_tasks set application_id = uid where id = t.id;
    return jsonb_build_object('application_id', uid);

  elsif op = 'vault_upsert' then
    insert into public.vault_credentials (user_id, host, label, login, secret_enc)
    values ((args->>'user_id')::uuid, args->>'host', args->>'label', args->>'login', args->>'secret_enc')
    on conflict (user_id, host) do update set login = excluded.login, secret_enc = excluded.secret_enc, label = coalesce(excluded.label, vault_credentials.label), last_used_at = now();
    return jsonb_build_object('ok', true);

  elsif op = 'vault_touch' then
    update public.vault_credentials set last_used_at = now() where user_id = (args->>'user_id')::uuid and host = args->>'host';
    return jsonb_build_object('ok', true);

  elsif op = 'mail_accounts' then
    return coalesce((select jsonb_agg(to_jsonb(m)) from public.mail_accounts m
      where m.status in ('active','pending') and (args->>'user_id' is null or m.user_id = (args->>'user_id')::uuid)), '[]'::jsonb);

  elsif op = 'mail_update' then
    update public.mail_accounts set
      status = coalesce(args->>'status', status),
      error = case when args ? 'error' then args->>'error' else error end,
      last_uid = coalesce((args->>'last_uid')::bigint, last_uid),
      last_sync_at = now()
    where user_id = (args->>'user_id')::uuid;
    return jsonb_build_object('ok', true);

  elsif op = 'inbox_insert' then
    with ins as (
      insert into public.inbox_messages (user_id, msg_id, from_addr, from_name, subject, snippet, body, received_at, kind, code, link, company, application_id, task_id, event)
      select (args->>'user_id')::uuid, m->>'msg_id', m->>'from_addr', m->>'from_name', m->>'subject', m->>'snippet', m->>'body',
             coalesce((m->>'received_at')::timestamptz, now()), coalesce(m->>'kind','other'), m->>'code', m->>'link', m->>'company',
             nullif(m->>'application_id','')::uuid, nullif(m->>'task_id','')::uuid, nullif(m->'event', 'null'::jsonb)
      from jsonb_array_elements(args->'messages') m
      on conflict (user_id, msg_id) do nothing
      returning msg_id
    ) select count(*), coalesce(jsonb_agg(msg_id), '[]'::jsonb) into n, out from ins;
    return jsonb_build_object('inserted', n, 'ids', out);

  elsif op = 'recent_codes' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'from_addr', from_addr, 'subject', subject, 'code', code, 'link', link, 'received_at', received_at) order by received_at desc)
      from public.inbox_messages where user_id = (args->>'user_id')::uuid and received_at >= (args->>'since')::timestamptz and (code is not null or link is not null)), '[]'::jsonb);

  elsif op = 'apps_for_matching' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'company', job->>'company', 'title', job->>'title', 'status', status))
      from public.applications where user_id = (args->>'user_id')::uuid and status not in ('withdrawn')), '[]'::jsonb);

  elsif op = 'app_event' then
    update public.applications set
      status = coalesce(args->>'status', status),
      events = events || jsonb_build_array(jsonb_build_object('at', now(), 'type', coalesce(args->>'type','email'), 'text', args->>'text'))
    where id = (args->>'application_id')::uuid and user_id = (args->>'user_id')::uuid;
    return jsonb_build_object('ok', true);

  elsif op = 'auto_users' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'autonomy', p.autonomy, 'daily_limit', p.daily_limit, 'name', p.full_name, 'role', p.role,
        'prefs', (select to_jsonb(x) from public.target_prefs x where x.user_id = p.id),
        'roles', coalesce((select jsonb_agg(to_jsonb(r)) from public.target_roles r where r.user_id = p.id and r.active), '[]'::jsonb),
        'auth', coalesce((select jsonb_agg(to_jsonb(w)) from public.work_auth w where w.user_id = p.id), '[]'::jsonb),
        -- The agent's own applications today: not ones you filled in your browser, not ones skipped before starting.
        'today', (select count(*) from public.agent_tasks a where a.user_id = p.id and a.created_at >= date_trunc('day', now())
                    and a.status <> 'extension' and (a.started_at is not null or a.status in ('queued','awaiting_approval'))),
        'known_jobs', coalesce((select jsonb_agg(a.job_id) from public.agent_tasks a where a.user_id = p.id), '[]'::jsonb)
          || coalesce((select jsonb_agg(ap.job_id) from public.applications ap where ap.user_id = p.id and ap.job_id is not null), '[]'::jsonb),
        -- Company + role of everything already sent, so a repost of the same job isn't applied to again.
        'known_roles', coalesce((select jsonb_agg(distinct private.co_key(a.job->>'company') || '|' || private.title_key(a.job->>'title'))
           from public.agent_tasks a where a.user_id = p.id and (a.status in ('submitted','extension','manual') or a.submit_clicked_at is not null)), '[]'::jsonb)
          || coalesce((select jsonb_agg(distinct private.co_key(ap.job->>'company') || '|' || private.title_key(ap.job->>'title'))
           from public.applications ap where ap.user_id = p.id and ap.applied_at is not null), '[]'::jsonb)
      ))
      from public.profiles p
      where p.onboarding_complete and p.agent_enabled and p.autonomy in ('fully_automatic','approve_important','approve_all')
        and p.adult_confirmed_at is not null
        and exists (select 1 from public.applicant_profiles ap where ap.user_id = p.id and ap.agent_consent and coalesce(ap.phone,'') <> '' and coalesce(ap.city,'') <> '')
        and exists (select 1 from public.resumes r where r.user_id = p.id and r.is_master and jsonb_array_length(coalesce(r.content->'experience','[]'::jsonb)) > 0)), '[]'::jsonb);

  elsif op = 'search' then
    return coalesce((select jsonb_agg(to_jsonb(s)) from public.search_jobs2(args->>'country', args->>'tsquery', (args->>'since')::timestamptz, coalesce((args->>'limit')::int, 300)) s), '[]'::jsonb);

  elsif op = 'insert_tasks' then
    with ins as (
      insert into public.agent_tasks (user_id, job_id, job, ats, apply_url, status, mode, priority, resume_id, resume_style, letter_tone, cover_letter)
      select (args->>'user_id')::uuid, x->>'job_id', x->'job', x->>'ats', x->>'apply_url', coalesce(x->>'status','queued'), case when x->>'mode' = 'dry_run' then 'dry_run' else 'submit' end,
             coalesce((x->>'priority')::int, 5), nullif(x->>'resume_id','')::uuid, x->>'resume_style', x->>'letter_tone', x->>'cover_letter'
      from jsonb_array_elements(args->'tasks') x
      on conflict (user_id, job_id) do update set
        job = excluded.job, ats = excluded.ats, apply_url = excluded.apply_url, status = excluded.status, mode = excluded.mode,
        priority = excluded.priority, resume_id = excluded.resume_id, resume_style = excluded.resume_style,
        letter_tone = excluded.letter_tone, cover_letter = excluded.cover_letter, cancel_reason = null,
        attempts = 0, needs = '[]'::jsonb, user_input = '{}'::jsonb, error = null, step = null,
        locked_at = null, started_at = null, finished_at = null, created_at = now(),
        log = agent_tasks.log || jsonb_build_array(jsonb_build_object('at', now(), 'text', 'Started again'))
        where agent_tasks.status in ('cancelled','failed','manual') and agent_tasks.submit_clicked_at is null
      returning id
    ) select count(*) into n from ins;
    return jsonb_build_object('inserted', n);

  elsif op = 'pause' then
    -- The worker is being updated: a run that hadn't pressed Submit goes back to the front of the line (the attempt
    -- doesn't count); one that had is never retried and says so.
    update public.agent_tasks set
      status = case when submit_clicked_at is null then 'queued' else 'manual' end,
      attempts = case when submit_clicked_at is null then greatest(attempts - 1, 0) else attempts end,
      priority = case when submit_clicked_at is null then least(priority, 2) else priority end,
      locked_at = null,
      finished_at = case when submit_clicked_at is null then null else now() end,
      step = case when submit_clicked_at is null then 'Paused for a quick Vantage update — starts again by itself. Nothing was sent.'
                  else 'Stopped right after pressing Submit' end,
      error = case when submit_clicked_at is null then null
                   else 'The run stopped right after pressing Submit during a Vantage update. Check your job email for a confirmation before trying again.' end,
      log = log || jsonb_build_array(jsonb_build_object('at', now(), 'text', case when submit_clicked_at is null
              then 'Paused for a Vantage update before anything was sent — back in line' else 'Stopped during a Vantage update after Submit was pressed' end))
    where id = (args->>'task_id')::uuid and status in ('running','waiting_code','needs_human')
    returning * into t;
    return to_jsonb(t);

  elsif op = 'queue_size' then
    return jsonb_build_object('queued', (select count(*) from public.agent_tasks where status = 'queued'));

  end if;
  raise exception 'unknown op %', op;
end;
$function$;
