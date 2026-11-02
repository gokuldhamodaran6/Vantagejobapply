-- Resume Studio: version history for every resume, and cached recruiter checks / interview kits.
create table if not exists public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null references public.resumes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null,
  reason text not null default 'edit',
  created_at timestamptz not null default now()
);
create index if not exists resume_versions_resume_idx on public.resume_versions (resume_id, created_at desc);
alter table public.resume_versions enable row level security;
drop policy if exists "own resume versions" on public.resume_versions;
create policy "own resume versions" on public.resume_versions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.resume_insights (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.resume_insights enable row level security;
drop policy if exists "own resume insights" on public.resume_insights;
create policy "own resume insights" on public.resume_insights for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Snapshot the previous content whenever a resume's content changes (uploads, edits, rewrites), keeping the last 20.
create or replace function public.snapshot_resume_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.content is distinct from old.content and old.content is not null then
    insert into public.resume_versions (resume_id, user_id, content, reason)
    values (old.id, old.user_id, old.content, coalesce(current_setting('vantage.version_reason', true), 'edit'));
    delete from public.resume_versions v
     where v.resume_id = old.id
       and v.id not in (select id from public.resume_versions where resume_id = old.id order by created_at desc limit 20);
  end if;
  return new;
end $$;
drop trigger if exists resumes_snapshot on public.resumes;
create trigger resumes_snapshot before update of content on public.resumes for each row execute function public.snapshot_resume_version();
