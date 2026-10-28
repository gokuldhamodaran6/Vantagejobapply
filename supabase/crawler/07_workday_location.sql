-- (applied as workday_location_from_path + workday_location_backfill)
-- Workday lists often give no location, or just "2 Locations": the primary location is in the job's own address
-- (/job/Mumbai/..., /job/US-CA-Santa-Clara/...). Without it, global boards' jobs (e.g. Accenture's Mumbai, Gurugram,
-- Chennai and Manila jobs) defaulted to the US and reached US job seekers' agents.
create or replace function private.wd_path_location(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(replace(substring(p from '/job/([^/?#]+)/'), '%20', ' '), '[-_]+', ' ', 'g')), '')
$$;

create or replace function private.wd_location(loc text, path text) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(loc, '') = '' then coalesce(private.wd_path_location(path), loc)
    when loc ~* '^\d+ locations?$' then coalesce(private.wd_path_location(path) || ' (+' || ((substring(loc from '^(\d+)'))::int - 1) || ' more)', loc)
    else loc end
$$;

create or replace function private.parse_workday(body text, host text, site text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('total', ((body::jsonb) ->> 'total')::int, 'items', coalesce(jsonb_agg(jsonb_build_object(
    'x', coalesce(nullif(x -> 'bulletFields' ->> 0, ''), regexp_replace(x ->> 'externalPath', '^.*_', '')),
    't', x ->> 'title', 'l', private.wd_location(x ->> 'locationsText', x ->> 'externalPath'),
    'r', coalesce(x ->> 'remoteType', '') ilike '%remote%' or coalesce(x ->> 'locationsText', '') ilike '%remote%',
    'u', 'https://' || host || '/en-US/' || site || (x ->> 'externalPath'),
    'p', private.wd_posted(x ->> 'postedOn'))), '[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof((body::jsonb) -> 'jobPostings') = 'array' then (body::jsonb) -> 'jobPostings' else '[]' end) x
  where x ->> 'externalPath' is not null
$$;

-- One-off backfill of existing jobs, 2,000 a minute; unschedules itself when done.
create or replace function private.wd_backfill() returns int
language plpgsql security definer set search_path = public, private set statement_timeout = '50s' as $$
declare n int;
begin
  with b as (
    select id from public.jobs
     where source = 'workday' and closed_at is null and (location is null or location ~* '^\d+ locations?$')
       and private.wd_path_location(url) is not null
     limit 2000)
  update public.jobs j set location = private.wd_location(j.location, j.url),
         country = coalesce(private.detect_country(private.wd_location(j.location, j.url), j.country), j.country)
    from b where j.id = b.id;
  get diagnostics n = row_count;
  if n = 0 then perform cron.unschedule('vantage-wd-backfill'); end if;
  return n;
end $$;
revoke all on function private.wd_backfill() from public, anon, authenticated;
select cron.schedule('vantage-wd-backfill', '* * * * *', 'select private.wd_backfill()');
