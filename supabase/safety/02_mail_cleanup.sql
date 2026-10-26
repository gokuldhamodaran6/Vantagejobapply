-- Vantage safety step: job emails only.
-- Paste into Supabase > SQL Editor and press Run (choose "Run this query" if warned).
-- 1) Lets a user's "Disconnect mailbox" also remove the job emails Vantage stored from it.
-- 2) Removes mail stored before today that isn't about the job search (not from a careers site,
--    no code, not linked to an application). Job emails, codes and replies are kept.

create or replace function public.forget_my_mail() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  delete from public.inbox_messages where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.forget_my_mail() from public, anon;
grant execute on function public.forget_my_mail() to authenticated;

delete from public.inbox_messages m
where m.kind = 'other'
  and m.application_id is null
  and m.code is null
  and (coalesce(m.from_addr, '') || ' ' || coalesce(m.from_name, '')) !~* '(greenhouse|lever\.co|ashbyhq|myworkday|workday|icims|taleo|successfactors|smartrecruiters|workable|recruitee|jobvite|bamboohr|breezy|jazzhr|applytojob|oraclecloud|avature|eightfold|phenom|gem\.com|rippling|teamtailor|personio|pinpointhq|dover|hirebridge|paylocity|paycom|ukg|ultipro|adp\.com|amazon\.jobs|hirevue|codesignal|hackerrank)'
  and coalesce(m.subject, '') !~* '(application|applied|candidate|career|recruit|talent|hiring|\mjob|position|interview|offer letter)';
