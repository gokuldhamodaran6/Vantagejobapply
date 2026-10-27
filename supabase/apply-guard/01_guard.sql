-- One guard against applying twice: same posting, a repost, a different link to the same job, or a run that may
-- already have pressed Submit. Used by the worker's claim, "Apply now", and safe retry.

alter table public.agent_tasks
  add column if not exists submit_clicked_at timestamptz,
  add column if not exists cancel_reason text;

-- Who cancelled: the person ("Don't send", "Skip", "Dismiss") or the system (setup pauses, duplicates).
update public.agent_tasks set cancel_reason = 'system'
 where status = 'cancelled' and cancel_reason is null and coalesce(step, '') ilike 'paused%';

-- A title without the noise page titles carry: "Apply to …", "- page 1", "… at Acme — Austin | LinkedIn Jobs".
create or replace function private.title_key(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t, '')), '^\s*apply (to|for)\s+', ''),
        '\s*[-–|]\s*page \d+( of \d+)?\s*$', ''),
      '( at [^|]*)?\s*\|\s*(linkedin|indeed)[^|]*$', ''),
    '[^a-z0-9+#]+', ' ', 'g'))
$$;

create or replace function private.co_key(n text) returns text
language sql immutable parallel safe set search_path = public as $$
  select btrim(regexp_replace(public.norm_company(n), '^[0-9]+ ', ''))
$$;

-- Same role: identical titles, or one is the other plus extra detail ("Product Manager, Radar" vs
-- "Product Manager, Radar - Fraud and Abuse Prevention") when the shorter one is specific (3+ words).
create or replace function private.same_role(a text, b text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  with k as (select private.title_key(a) ka, private.title_key(b) kb)
  select ka <> '' and (ka = kb or (
    array_length(regexp_split_to_array(case when length(ka) <= length(kb) then ka else kb end, ' '), 1) >= 3
    and (ka like kb || ' %' or kb like ka || ' %')))
  from k
$$;

-- Null when it's fine to apply; otherwise the reason, in words the person sees.
create or replace function private.apply_block(p_user uuid, p_task uuid, p_job_id text, p_company text, p_title text)
returns text language sql stable security definer set search_path = public, private as $$
  select coalesce(
    (select case when s.status = 'submitted' then 'You already applied to this job'
                 else 'An earlier run may already have submitted this job — check your email for a confirmation' end
       from public.agent_tasks s
      where s.user_id = p_user and s.id is distinct from p_task
        and (s.status = 'submitted' or s.submit_clicked_at is not null)
        and (s.job_id = p_job_id or (private.co_key(s.job->>'company') = private.co_key(p_company) and private.same_role(s.job->>'title', p_title)))
      order by (s.status = 'submitted') desc limit 1),
    (select case when a.status = 'rejected' then 'This company already turned down your application for this role'
                 else 'You already applied to this job' end
       from public.applications a
      where a.user_id = p_user and a.applied_at is not null and a.status not in ('saved', 'ready')
        and (a.job_id = p_job_id or (private.co_key(a.job->>'company') = private.co_key(p_company) and private.same_role(a.job->>'title', p_title)))
      limit 1))
$$;
revoke all on function private.apply_block(uuid, uuid, text, text, text) from public, anon, authenticated;

-- "Apply now / Apply again" on one job: refuses duplicates and runs that may have been submitted,
-- and keeps the person's approvals when the job is only being moved up the line.
create or replace function public.apply_now(p_task uuid) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare t public.agent_tasks; why text;
begin
  select * into t from public.agent_tasks where id = p_task and user_id = auth.uid();
  if not found then return false; end if;
  if t.submit_clicked_at is not null then
    raise exception 'This one may already have been submitted. Check your job email for a confirmation before trying again.';
  end if;
  why := private.apply_block(t.user_id, t.id, t.job_id, t.job->>'company', t.job->>'title');
  if why is not null then raise exception '%', why; end if;
  if t.status = 'queued' then
    update public.agent_tasks set priority = 1, step = 'Moved to the front — starting now', updated_at = now() where id = p_task;
    return found;
  end if;
  update public.agent_tasks
     set status = 'queued', priority = 1, needs = '[]'::jsonb, error = null, locked_at = null, cancel_reason = null,
         user_input = '{}'::jsonb, step = 'Moved to the front — starting now', finished_at = null, updated_at = now()
   where id = p_task and status in ('cancelled','failed','manual','awaiting_approval','needs_user');
  return found;
end $$;

-- Safe retry: only runs that stopped before submitting, and only jobs nobody chose to skip. Returns how many went back.
create or replace function public.requeue_tasks(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public, private as $$
declare n integer;
begin
  update public.agent_tasks t
     set status = 'queued', needs = '[]'::jsonb, error = null, locked_at = null, user_input = '{}'::jsonb, cancel_reason = null,
         step = 'Back in line', finished_at = null, updated_at = now()
   where t.id = any(p_ids) and t.user_id = auth.uid()
     and t.submit_clicked_at is null
     and (t.status = 'failed' or (t.status = 'cancelled' and t.cancel_reason = 'system'))
     and private.apply_block(t.user_id, t.id, t.job_id, t.job->>'company', t.job->>'title') is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- What "Retry" would do with each job that didn't finish, and why the others stay where they are.
create or replace function public.retry_preview() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.job->>'title', 'company', t.job->>'company', 'status', t.status,
    'why', case
      when t.submit_clicked_at is not null then 'Submit was already pressed — it may have been sent'
      when t.status = 'cancelled' and coalesce(t.cancel_reason, 'user') = 'user' then 'You chose to skip it'
      when t.status = 'cancelled' and t.cancel_reason = 'duplicate' then 'Already applied'
      else private.apply_block(t.user_id, t.id, t.job_id, t.job->>'company', t.job->>'title') end
  ) order by t.updated_at desc), '[]'::jsonb)
  from public.agent_tasks t
  where t.user_id = auth.uid() and (t.status = 'failed' or t.status = 'cancelled')
    and t.updated_at > now() - interval '30 days'
$$;
grant execute on function public.retry_preview() to authenticated;
