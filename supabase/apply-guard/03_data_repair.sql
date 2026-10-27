-- One-off repair of records the audit found wrong (founder account). Updates and one insert only — nothing deleted.
do $$
declare u uuid := '332a5776-9caa-404c-b557-f28ae413e55d'; app uuid;
begin
  -- Clean names on extension applications (titles and companies came from page titles and host names).
  update public.agent_tasks set job = job || '{"company":"First Command Financial Services","title":"Financial Product Marketing Specialist"}'::jsonb
   where user_id = u and id in ('ddc90f52-b5dc-435b-b296-8adb83986448','a1a6a003-6951-47ec-b452-40c8ccff74b8','f45634a2-74df-4893-a5d3-12bac71c5699');
  update public.applications set job = job || '{"company":"First Command Financial Services","title":"Financial Product Marketing Specialist"}'::jsonb
   where user_id = u and id in ('56f7d634-f8a0-4cb6-9eff-dfbd48ed174d','c8d73169-db4d-4794-b835-f41d135466ef');
  update public.agent_tasks set job = job || '{"company":"Metrc","title":"Product Marketing Manager"}'::jsonb where user_id = u and id = '21bd150f-f02a-4321-9211-9e8a97c5f128';
  update public.applications set job = job || '{"company":"Metrc","title":"Product Marketing Manager"}'::jsonb where user_id = u and id = '8fca8516-1416-443c-a5f2-263505baa80e';
  update public.agent_tasks set job = job || '{"company":"IDEAL Industries","title":"Senior CRM Specialist"}'::jsonb where user_id = u and id in ('92d5afae-e9f4-45ff-9906-6d73a978099f','17179272-b5b3-4ce8-a60e-24a312ac4a65');
  update public.applications set job = job || '{"company":"IDEAL Industries","title":"Senior CRM Specialist"}'::jsonb where user_id = u and id = 'e7861fc6-3445-490e-96fa-cc35494d38f1';
  update public.inbox_messages set application_id = 'e7861fc6-3445-490e-96fa-cc35494d38f1' where user_id = u and id = 'ad9dddfd-0f68-4fac-a555-1921488e682a';
  update public.agent_tasks set job = job || '{"company":"NVIDIA"}'::jsonb where user_id = u and id = 'e6851a52-9ccc-4475-9ad8-f6defcb9fe32';
  update public.applications set job = job || '{"company":"NVIDIA"}'::jsonb where user_id = u and id = '752d2785-d383-460a-80b5-1ac4334eac58';
  update public.agent_tasks set job = job || '{"company":"Verizon"}'::jsonb where user_id = u and id = '0cdf8660-c6bd-4192-8ea1-d3df03dcbee5';

  -- "Finish on site" / "in your browser" cards for jobs that were already applied to another way.
  update public.agent_tasks set status = 'cancelled', cancel_reason = 'duplicate', step = 'Already applied another way', finished_at = now()
   where user_id = u and id in ('b060409e-47db-4d7b-bd71-a29dba62f983','f45634a2-74df-4893-a5d3-12bac71c5699','17179272-b5b3-4ce8-a60e-24a312ac4a65','8d485fc1-f0fe-47af-a10b-801e5d989403');
  -- Pages that were never jobs.
  update public.agent_tasks set status = 'cancelled', cancel_reason = 'system', step = 'Not a job page — removed', finished_at = now()
   where user_id = u and id in ('14e4641c-2a39-428b-88b7-fc141054dc44','0aa7a0e5-1daa-4f27-885e-0baea97517b0');

  -- Pearson: the employer's receipt proves it was submitted; record it.
  update public.agent_tasks set status = 'submitted', step = 'Applied', finished_at = '2026-10-27 05:04:00+00',
         log = log || jsonb_build_array(jsonb_build_object('at', now(), 'text', 'Marked as applied: Pearson emailed a receipt'))
   where user_id = u and id = '1b47a22e-b3b3-4f27-bbfe-42af3273d485' and status = 'extension';
  if not exists (select 1 from public.applications where user_id = u and agent_task_id = '1b47a22e-b3b3-4f27-bbfe-42af3273d485') then
    insert into public.applications (user_id, job_id, job, target_role_id, resume_id, status, match_score, cover_letter, answers, applied_at, events, source, agent_task_id, resume_style, letter_tone)
    select t.user_id, t.job_id, t.job, nullif(t.job->>'role_id','')::uuid, t.resume_id, 'applied', nullif(t.job->>'match','')::int, t.cover_letter, '{}'::jsonb, '2026-10-27 05:04:00+00',
           jsonb_build_array(jsonb_build_object('at', '2026-10-27T05:04:00Z', 'type', 'applied', 'text', 'Submitted with the Vantage extension (Pearson emailed a receipt)')),
           'extension', t.id, t.resume_style, t.letter_tone
      from public.agent_tasks t where t.id = '1b47a22e-b3b3-4f27-bbfe-42af3273d485'
    on conflict (user_id, job_id) do nothing
    returning id into app;
    if app is not null then
      update public.agent_tasks set application_id = app where id = '1b47a22e-b3b3-4f27-bbfe-42af3273d485';
      update public.inbox_messages set application_id = app where user_id = u and id = '8d2c535e-167d-41f1-a259-1af93282147f';
    end if;
  end if;

  -- Jobs paused by the 18+ check: the check is done now; say so (they wait for the person's own "Try again").
  update public.agent_tasks set error = 'You''ve confirmed you''re 18 or older — press Try again to apply, or Dismiss if you don''t want this job.'
   where user_id = u and status = 'manual' and error ilike 'Confirm you''re 18 or older%';

  -- Loadsmart's receipt was read as a rejection.
  update public.inbox_messages set kind = 'received' where user_id = u and id = 'fd3a2bd7-b785-4747-a85b-9bfc012ea87d';
  update public.applications set status = 'applied',
         events = events || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'note', 'text', 'Corrected: Loadsmart''s email was a receipt, not a rejection'))
   where user_id = u and id = 'd732d754-ce5c-4b35-b8ba-3cca75527d00' and status = 'rejected';
  -- First Command's "further action may be required" email asks for action.
  update public.inbox_messages set kind = 'action' where user_id = u and id = '7f96242f-d401-47d1-adb0-f34c192af1af';

  -- A "ready" application that was never sent shouldn't count as applied.
  update public.applications set applied_at = null where user_id = u and status in ('saved','ready') and applied_at is not null;
end $$;

-- Everyone: an automatic receipt is not "Under review". Move back to "Applied" any application whose only
-- emails so far are receipts.
update public.applications a set status = 'applied'
 where a.status = 'in_review'
   and not exists (select 1 from jsonb_array_elements(coalesce(a.events, '[]'::jsonb)) e where e->>'type' not in ('applied', 'received', 'note'));
