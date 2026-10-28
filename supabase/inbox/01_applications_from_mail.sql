-- Applications from any site's confirmation email (extension-first Vantage).
--
-- When the inbox reader sees an application receipt ("Your application was sent to Stripe", "Indeed Application: Data
-- Analyst", a Workday/Greenhouse/Lever/Ashby/iCIMS/SmartRecruiters/Taleo receipt) that matches no application, the mail
-- sync calls this function. It creates the application (status 'applied', source 'email', applied_at = the email's date)
-- or, when the same company + same/similar role was already tracked in the 30 days around the email, updates that one.
--
-- Called by src/lib/agent/mailsync.ts with the ingest secret (same guard as agent_rpc); the app keeps working without it.
--
-- args: { user_id uuid, msg_id text, company text, title text|null, title_guess bool, url text|null, board text|null,
--         applied_at timestamptz, sender text }
-- returns: { application_id, created bool, status, company, title }

create or replace function public.mail_application_upsert(secret text, args jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
declare
  uid uuid := nullif(args->>'user_id', '')::uuid;
  co text := left(nullif(btrim(args->>'company'), ''), 120);
  ti text := left(nullif(btrim(args->>'title'), ''), 160);
  guess boolean := coalesce((args->>'title_guess')::boolean, false);
  url text := left(coalesce(nullif(btrim(args->>'url'), ''), ''), 1000);
  at timestamptz := coalesce(nullif(args->>'applied_at', '')::timestamptz, now());
  sender text := left(coalesce(nullif(btrim(args->>'sender'), ''), nullif(btrim(args->>'company'), ''), 'the company'), 120);
  mid text := nullif(args->>'msg_id', '');
  ck text;
  tk text;
  hit public.applications;
  app_id uuid;
  was_guess boolean;
  st text;
begin
  perform private.check_secret(secret);
  if uid is null or co is null then
    raise exception 'user_id and company are required';
  end if;
  if at > now() + interval '1 day' then at := now(); end if;
  -- Never invent a title: an unreadable one is shown as "Role at <Company>" and marked for the person to confirm.
  if ti is null then ti := 'Role at ' || co; guess := true; end if;
  ck := private.co_key(co);
  tk := private.title_key(ti);
  if ck = '' then raise exception 'company is required'; end if;

  -- Two syncs at once (cron + "Sync now") must not create the same application twice.
  perform pg_advisory_xact_lock(hashtext('mail_app:' || uid::text || ':' || ck));

  -- Same company (exact or "Datadog" vs "Datadog Careers") and the same or a similar role (or an unread title on either
  -- side), applied within 30 days of this email: update it rather than add a second row.
  select * into hit from public.applications a
   where a.user_id = uid
     and (private.co_key(a.job->>'company') = ck
          or (length(ck) >= 4 and private.co_key(a.job->>'company') like ck || ' %')
          or (length(private.co_key(a.job->>'company')) >= 4 and ck like private.co_key(a.job->>'company') || ' %'))
     and coalesce(a.applied_at, a.created_at) between at - interval '30 days' and at + interval '30 days'
     and (guess
          or coalesce((a.job->>'title_guess')::boolean, false)
          or private.title_key(a.job->>'title') = tk
          or (length(tk) >= 4 and length(private.title_key(a.job->>'title')) >= 4
              and (position(tk in private.title_key(a.job->>'title')) > 0 or position(private.title_key(a.job->>'title') in tk) > 0)))
   order by (private.title_key(a.job->>'title') = tk) desc, coalesce(a.applied_at, a.created_at) desc
   limit 1
   for update;

  if found then
    was_guess := coalesce((hit.job->>'title_guess')::boolean, false);
    update public.applications set
      -- Never backwards: only a saved / ready-to-apply row becomes Applied.
      status = case when status in ('saved', 'ready') then 'applied' else status end,
      applied_at = coalesce(applied_at, at),
      job = (case when was_guess and not guess then (job - 'title_guess') || jsonb_build_object('title', ti) else job end)
            || case when coalesce(job->>'url', '') = '' and url <> '' then jsonb_build_object('url', url) else '{}'::jsonb end,
      events = case when mid is not null and events @> jsonb_build_array(jsonb_build_object('msg_id', mid)) then events
                    else events || jsonb_build_array(jsonb_build_object('at', at, 'type', 'received', 'msg_id', mid,
                           'text', 'Found in your inbox: confirmation from ' || sender)) end
    where id = hit.id
    returning id, status, job->>'company', job->>'title' into app_id, st, co, ti;
    if mid is not null then
      update public.inbox_messages set application_id = app_id where user_id = uid and msg_id = mid and application_id is null;
    end if;
    return jsonb_build_object('application_id', app_id, 'created', false, 'status', st, 'company', co, 'title', ti);
  end if;

  insert into public.applications (user_id, job_id, job, status, applied_at, events, source)
  values (
    uid, null,
    jsonb_strip_nulls(jsonb_build_object(
      'title', ti, 'company', co, 'url', url, 'country', coalesce(nullif(args->>'country', ''), ''),
      'title_guess', case when guess then true end,
      'board', nullif(btrim(args->>'board'), ''),
      'found_in', 'email')),
    'applied', at,
    jsonb_build_array(jsonb_build_object('at', at, 'type', 'applied', 'msg_id', mid, 'text', 'Found in your inbox: confirmation from ' || sender)),
    'email')
  returning id into app_id;
  if mid is not null then
    update public.inbox_messages set application_id = app_id where user_id = uid and msg_id = mid and application_id is null;
  end if;
  return jsonb_build_object('application_id', app_id, 'created', true, 'status', 'applied', 'company', co, 'title', ti);
end;
$function$;

revoke all on function public.mail_application_upsert(text, jsonb) from public;
grant execute on function public.mail_application_upsert(text, jsonb) to anon, authenticated, service_role;
