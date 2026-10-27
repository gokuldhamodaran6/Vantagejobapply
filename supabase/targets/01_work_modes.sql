-- Applied as migration "target_prefs_work_modes".
-- Accepted work arrangements for a person's job search (on-site / hybrid / remote).
-- Nullable: rows without it keep the old behaviour, decided by remote_ok.
alter table public.target_prefs add column if not exists work_modes text[];
alter table public.target_prefs drop constraint if exists target_prefs_work_modes_check;
alter table public.target_prefs add constraint target_prefs_work_modes_check
  check (work_modes is null or work_modes <@ array['onsite','hybrid','remote']::text[]);
comment on column public.target_prefs.work_modes is 'Accepted work arrangements: onsite, hybrid, remote. NULL = all, or on-site/hybrid only when remote_ok is false.';
