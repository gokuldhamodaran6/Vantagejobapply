-- Applied as migration ext_02_task_report (2026-10-29).
-- What the resume written for this job covers (skills matched/missing, country format, Harvard checks), shown in the
-- Chrome extension's panel while it fills the company's form. Written by the server only.
alter table public.agent_tasks add column if not exists report jsonb;

create or replace function public.task_report(secret text, op text, args jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public', 'private'
as $$
declare r jsonb;
begin
  perform private.check_secret(secret);
  if op = 'set' then
    update public.agent_tasks set report = args->'report' where id = (args->>'task_id')::uuid;
    return jsonb_build_object('ok', true);
  elsif op = 'get' then
    select jsonb_build_object('user_id', user_id, 'status', status, 'ready', coalesce(cover_letter, '') <> '' , 'resume_id', resume_id, 'report', report)
      into r from public.agent_tasks where id = (args->>'task_id')::uuid;
    return r;
  end if;
  raise exception 'unknown op %', op;
end $$;
revoke all on function public.task_report(text, text, jsonb) from public;
grant execute on function public.task_report(text, text, jsonb) to anon, authenticated, service_role;
