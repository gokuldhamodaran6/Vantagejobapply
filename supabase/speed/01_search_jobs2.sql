-- Live jobs search, 4.5 s → 0.3 s (applied as search_jobs2_custom_plan):
-- planned for the actual query every call (force_custom_plan, so the full-text index is used), ranked by title on narrow
-- rows, and full rows (descriptions) loaded only for the winners.
CREATE OR REPLACE FUNCTION public.search_jobs2(p_country text, p_tsquery text, p_since timestamp with time zone, p_limit integer DEFAULT 800)
 RETURNS TABLE(id text, source text, country text, title text, company text, location text, remote boolean, description text, url text, salary_min numeric, salary_max numeric, currency text, category text, contract_time text, posted_at timestamp with time zone, sponsorship text, sponsor_registered boolean, restrictions text[], first_seen_at timestamp with time zone, reposts integer, rank real)
 LANGUAGE plpgsql STABLE SET search_path TO 'public' SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare q tsquery := to_tsquery('english', p_tsquery);
begin
  return query
  with top as (
    select j.id as jid, ts_rank(setweight(to_tsvector('english', j.title), 'A'), q) as r, coalesce(j.posted_at, j.first_seen_at) as d
    from public.jobs j
    where j.country = upper(p_country) and j.closed_at is null and j.fts @@ q and coalesce(j.posted_at, j.first_seen_at) >= p_since
    order by 2 desc, 3 desc
    limit least(greatest(p_limit, 1), 1000)
  )
  select j.id, j.source, j.country, j.title, j.company, j.location, j.remote, left(j.description, 3500), j.url,
         j.salary_min, j.salary_max, j.currency, j.category, j.contract_time, j.posted_at,
         j.sponsorship, j.sponsor_registered, j.restrictions, j.first_seen_at, j.reposts, top.r
  from top join public.jobs j on j.id = top.jid
  order by top.r desc, top.d desc;
end $function$;
