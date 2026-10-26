-- Vantage job crawler, part 1: schema and text helpers.
-- Jobs are read straight from each employer's public careers feed (Greenhouse, Lever, Ashby, Workday, ...).
-- The crawler runs inside Postgres with pg_net, so no extra servers are needed.

alter table public.boards drop constraint if exists boards_ats_check;
alter table public.boards add constraint boards_ats_check check (ats in (
  'greenhouse','lever','ashby','smartrecruiters','workable','recruitee','workday','amazon',
  'personio','teamtailor','rippling','pinpoint','breezy','bamboohr','gem'));

alter table public.boards
  add column if not exists status text not null default 'active',
  add column if not exists next_run_at timestamptz not null default now(),
  add column if not exists last_run_at timestamptz,
  add column if not exists last_change_at timestamptz,
  add column if not exists fail_count int not null default 0,
  add column if not exists discovered_via text,
  add column if not exists region text,
  add column if not exists sig text,
  add column if not exists capped boolean not null default false;
alter table public.boards drop constraint if exists boards_status_check;
alter table public.boards add constraint boards_status_check check (status in ('pending','active','empty','dead','off'));
create index if not exists boards_due_idx on public.boards (ats, next_run_at) where status in ('pending','active','empty');
create index if not exists boards_status_idx on public.boards (status);

-- SmartRecruiters' API robots.txt allows only LinkedInBot, so Vantage does not crawl it.
update public.boards set status = 'off', active = false where ats = 'smartrecruiters';
update public.boards set status = 'active', next_run_at = now() where ats <> 'smartrecruiters' and active;

alter table public.jobs
  add column if not exists board_id bigint,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists closed_at timestamptz,
  add column if not exists hash text,
  add column if not exists repost_of text,
  add column if not exists reposts int not null default 0,
  add column if not exists title_norm text,
  add column if not exists seen_at timestamptz;

create or replace function private.title_norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9+#]+', ' ', 'g'))
$$;

create or replace function private.jobs_title_norm() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.title_norm := private.title_norm(new.title);
  return new;
end $$;
drop trigger if exists jobs_title_norm on public.jobs;
create trigger jobs_title_norm before insert or update of title on public.jobs
  for each row execute function private.jobs_title_norm();

-- Backfill: normalised titles, first-seen dates, shorter descriptions, and links to boards.
update public.jobs set
  title_norm = private.title_norm(title),
  first_seen_at = coalesce(posted_at, fetched_at, now()),
  description = left(description, 6000);

update public.jobs j set board_id = b.id
from public.boards b
where j.board_id is null
  and b.token = split_part(j.id, ':', 2)
  and b.ats = case split_part(j.id, ':', 1)
    when 'gh' then 'greenhouse' when 'lever' then 'lever' when 'ashby' then 'ashby' when 'wd' then 'workday'
    when 'wk' then 'workable' when 'rc' then 'recruitee' when 'sr' then 'smartrecruiters' when 'amazon' then 'amazon' end;

-- Search only needs the title and company, so the index no longer carries descriptions.
drop index if exists public.jobs_fts_idx;
alter table public.jobs drop column if exists fts;
alter table public.jobs add column fts tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(company, '')), 'B')) stored;
create index if not exists jobs_fts_open_idx on public.jobs using gin (fts) where closed_at is null;
drop index if exists public.jobs_country_posted_idx;
create index if not exists jobs_open_country_posted_idx on public.jobs (country, posted_at desc) where closed_at is null;
create index if not exists jobs_board_open_idx on public.jobs (board_id) where closed_at is null;
create index if not exists jobs_board_title_idx on public.jobs (board_id, title_norm);

-- ---------------------------------------------------------------- helpers
create or replace function private.html_decode(h text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select replace(replace(replace(replace(replace(replace(coalesce(h, ''),
    '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&#x27;', ''''), '&amp;', '&')
$$;

create or replace function private.html_text(h text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(regexp_replace(regexp_replace(coalesce(h, ''),
        '<\s*(br|/p|/li|/h[1-6]|/div|/tr|/ul|/ol)\s*/?>', E'\n', 'gi'),
        '<li[^>]*>', '• ', 'gi'),
        '<[^>]+>', ' ', 'g'),
      '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&rsquo;', ''''),
      '&lsquo;', ''''), '&ndash;', '-'), '&amp;', '&'),
    '[ \t\r\f\v]+', ' ', 'g'), '\n\s*\n+', E'\n', 'g'))
$$;

create or replace function private.jbool(v jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(lower(v #>> '{}') in ('true', 't', '1', 'yes'), false)
$$;

create or replace function private.num(v text) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select case when v ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then v::numeric end
$$;

create or replace function private.ts(v text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  if v ~ '^[0-9]{12,14}$' then return to_timestamp(v::bigint / 1000.0); end if;
  return replace(replace(v, ' UTC', 'Z'), ' ', 'T')::timestamptz;
exception when others then
  return null;
end $$;

-- Workday shows relative dates: "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago".
create or replace function private.wd_posted(v text) returns text
language sql stable set search_path = '' as $$
  select case
    when v ilike '%today%' then now()::text
    when v ilike '%yesterday%' then (now() - interval '1 day')::text
    when v ~* '([0-9]+)\+?\s*day' then (now() - make_interval(days => (substring(v from '([0-9]+)'))::int))::text
  end
$$;

create or replace function private.country_code(v text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when v is null or btrim(v) = '' then null
    when length(btrim(v)) = 2 then case upper(btrim(v)) when 'UK' then 'GB' else upper(btrim(v)) end
    when length(btrim(v)) = 3 then ('{"USA":"US","GBR":"GB","CAN":"CA","AUS":"AU","IND":"IN","DEU":"DE","IRL":"IE","NLD":"NL","FRA":"FR","ESP":"ES","SGP":"SG","NZL":"NZ","CHE":"CH","SWE":"SE","POL":"PL","PRT":"PT","ITA":"IT","BRA":"BR","MEX":"MX","JPN":"JP","ARE":"AE","ISR":"IL"}'::jsonb) ->> upper(btrim(v))
    else ('{"united states":"US","united states of america":"US","usa":"US","us":"US","united kingdom":"GB","great britain":"GB","england":"GB","scotland":"GB","canada":"CA","australia":"AU","germany":"DE","deutschland":"DE","ireland":"IE","india":"IN","singapore":"SG","netherlands":"NL","the netherlands":"NL","france":"FR","spain":"ES","new zealand":"NZ","switzerland":"CH","sweden":"SE","norway":"NO","denmark":"DK","finland":"FI","poland":"PL","portugal":"PT","italy":"IT","belgium":"BE","austria":"AT","japan":"JP","brazil":"BR","mexico":"MX","united arab emirates":"AE","israel":"IL","czech republic":"CZ","czechia":"CZ","romania":"RO","philippines":"PH","south africa":"ZA","argentina":"AR","colombia":"CO","hong kong":"HK","china":"CN","south korea":"KR","korea, republic of":"KR","estonia":"EE","lithuania":"LT","latvia":"LV","greece":"GR","hungary":"HU","ukraine":"UA","turkey":"TR","türkiye":"TR","chile":"CL","peru":"PE","malaysia":"MY","indonesia":"ID","thailand":"TH","vietnam":"VN","viet nam":"VN","pakistan":"PK","egypt":"EG","nigeria":"NG","kenya":"KE","saudi arabia":"SA","qatar":"QA","luxembourg":"LU","bulgaria":"BG","croatia":"HR","serbia":"RS","slovakia":"SK","slovenia":"SI","cyprus":"CY","malta":"MT","iceland":"IS","costa rica":"CR","uruguay":"UY","taiwan":"TW"}'::jsonb) ->> lower(btrim(v))
  end
$$;

-- Best-effort country from free-text locations. Country names win over cities, so
-- "Birmingham, AL" stays in the US and "Sydney, New South Wales" stays in Australia.
create or replace function private.detect_country(loc text, fallback text default null) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  l text := lower(coalesce(loc, ''));
  r text[];
  names text[][] := array[
    ['(^|[^a-z])(united states|usa|u\.s\.a?\.?|us-remote|remote[- ,(]*us)([^a-z]|$)', 'US'],
    ['\ycanada\y', 'CA'], ['\yaustralia\y', 'AU'], ['\ynew zealand\y', 'NZ'],
    ['\y(united kingdom|uk|england|scotland|great britain|northern ireland)\y', 'GB'],
    ['\yireland\y', 'IE'], ['\yindia\y', 'IN'], ['\y(germany|deutschland)\y', 'DE'], ['\y(netherlands|holland)\y', 'NL'],
    ['\yfrance\y', 'FR'], ['\yspain\y', 'ES'], ['\ysingapore\y', 'SG'], ['\y(uae|united arab emirates)\y', 'AE'],
    ['\yjapan\y', 'JP'], ['\ypoland\y', 'PL'], ['\yswitzerland\y', 'CH'], ['\ysweden\y', 'SE'], ['\yportugal\y', 'PT'],
    ['\ymexico\y', 'MX'], ['\ybrazil\y', 'BR'], ['\ynorway\y', 'NO'], ['\ydenmark\y', 'DK'], ['\yfinland\y', 'FI'],
    ['\yitaly\y', 'IT'], ['\ybelgium\y', 'BE'], ['\yaustria\y', 'AT'], ['\yisrael\y', 'IL'], ['\yphilippines\y', 'PH'],
    ['\ysouth africa\y', 'ZA'], ['\yargentina\y', 'AR'], ['\ycolombia\y', 'CO'], ['\y(czech republic|czechia)\y', 'CZ'],
    ['\yromania\y', 'RO'], ['\yhong kong\y', 'HK'], ['\y(south )?korea\y', 'KR'], ['\ychina\y', 'CN'], ['\ymalaysia\y', 'MY'],
    ['\yindonesia\y', 'ID'], ['\yvietnam\y', 'VN'], ['\yturkey\y', 'TR'], ['\ygreece\y', 'GR'], ['\yestonia\y', 'EE'],
    ['\ylithuania\y', 'LT'], ['\yukraine\y', 'UA'], ['\yhungary\y', 'HU'], ['\yegypt\y', 'EG'], ['\ykenya\y', 'KE'],
    ['\ynigeria\y', 'NG'], ['\ysaudi arabia\y', 'SA'], ['\ychile\y', 'CL'], ['\ycosta rica\y', 'CR'], ['\ytaiwan\y', 'TW']];
  cities text[][] := array[
    ['\y(new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|dallas|houston|washington,? d\.?c|palo alto|mountain view|menlo park|sunnyvale|san jose|san diego|philadelphia|pittsburgh|salt lake city|raleigh|nashville|phoenix|minneapolis|detroit|bay area|silicon valley|brooklyn|cupertino|redwood city|santa clara|irvine|charlotte|columbus|indianapolis|kansas city|st\.? louis|tampa|orlando|baltimore|cincinnati|cleveland|sacramento|las vegas)\y', 'US'],
    ['\y(london|manchester|edinburgh|glasgow|bristol|leeds|belfast|cardiff|liverpool|newcastle|nottingham|sheffield|reading|brighton)\y', 'GB'],
    ['\y(toronto|vancouver|montreal|montréal|calgary|ottawa|waterloo|edmonton|winnipeg|halifax|quebec city|mississauga)\y', 'CA'],
    ['\y(sydney|melbourne|brisbane|perth|adelaide|canberra|gold coast)\y', 'AU'],
    ['\y(auckland|wellington|christchurch)\y', 'NZ'], ['\y(dublin|cork|galway|limerick)\y', 'IE'],
    ['\y(berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|dusseldorf|leipzig)\y', 'DE'],
    ['\y(amsterdam|rotterdam|utrecht|the hague|eindhoven)\y', 'NL'], ['\y(paris|lyon|toulouse|marseille)\y', 'FR'],
    ['\y(madrid|barcelona|valencia)\y', 'ES'],
    ['\y(bengaluru|bangalore|hyderabad|pune|mumbai|chennai|gurgaon|gurugram|noida|new delhi|delhi|kolkata|ahmedabad)\y', 'IN'],
    ['\y(dubai|abu dhabi)\y', 'AE'], ['\y(tokyo|osaka)\y', 'JP'], ['\y(warsaw|kraków|krakow|wroclaw|wrocław)\y', 'PL'],
    ['\y(zurich|zürich|geneva|basel|lausanne)\y', 'CH'], ['\y(stockholm|gothenburg|malmö)\y', 'SE'], ['\y(lisbon|porto)\y', 'PT'],
    ['\ymexico city\y', 'MX'], ['\y(são paulo|sao paulo|rio de janeiro)\y', 'BR'], ['\y(tel aviv|jerusalem)\y', 'IL'],
    ['\y(oslo)\y', 'NO'], ['\y(copenhagen)\y', 'DK'], ['\y(helsinki)\y', 'FI'], ['\y(milan|rome)\y', 'IT'],
    ['\y(brussels|antwerp)\y', 'BE'], ['\y(vienna)\y', 'AT'], ['\y(prague)\y', 'CZ'], ['\y(bucharest)\y', 'RO'],
    ['\y(manila|cebu)\y', 'PH'], ['\y(cape town|johannesburg)\y', 'ZA'], ['\y(buenos aires)\y', 'AR'], ['\y(bogotá|bogota|medellín|medellin)\y', 'CO']];
begin
  if btrim(l) = '' then return fallback; end if;
  foreach r slice 1 in array names loop
    if l ~ r[1] then return r[2]; end if;
  end loop;
  if loc ~ ',\s*(ON|BC|QC|AB|MB|SK|NS|NB|NL|PE)\y' then return 'CA'; end if;
  if loc ~ ',\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\y' then return 'US'; end if;
  foreach r slice 1 in array cities loop
    if l ~ r[1] then return r[2]; end if;
  end loop;
  return fallback;
end $$;

-- Visa and eligibility signals from the job text (same rules as src/lib/jobs/signals.ts).
create or replace function private.job_signals(title text, descr text,
  out sponsorship text, out restrictions text[], out remote boolean)
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  t text := lower(coalesce(title, ''));
  d text := regexp_replace(lower(coalesce(descr, '')), '\s+', ' ', 'g');
  a text := t || ' ' || d;
begin
  sponsorship := 'silent';
  if a ~ any (array[
    '(not|unable to|cannot|can''t|won''t|will not|do not|does not|don''t) (be able to )?(offer |provide |support )?(visa )?sponsor',
    'no (visa )?sponsorship',
    'sponsorship (is )?(not|un)available',
    'without (the need for )?(current or future |now or in the future )?(visa )?sponsorship',
    'must (currently )?(have|hold|possess) (the )?(full |existing |unrestricted )?(right|authori[sz]ation|eligibility) to work',
    'must be (legally )?(authori[sz]ed|eligible) to work in the (us|u\.s\.|united states|uk|united kingdom|canada|australia)[^.]{0,60}without',
    'not (able|in a position) to (offer|provide|support) (visa|work permit)']) then
    sponsorship := 'no';
  elsif a ~ any (array[
    'visa sponsorship (is )?(available|offered|provided|possible)',
    '(we|will|can|able to|happy to|willing to) (offer |provide )?sponsor',
    'sponsorship (is )?(available|offered|provided|considered)',
    '(h-?1b|h1-?b) (sponsorship|transfer)s? (available|welcome|considered|supported)',
    'skilled worker (visa|sponsorship|route)',
    'certificate of sponsorship',
    'tier ?2 sponsorship',
    'lmia (support|approved|available|provided)',
    '(482|skills in demand|sid) visa sponsorship',
    'relocation (and|&) visa (support|sponsorship)',
    'visa (support|assistance) (is )?(available|provided|offered)']) then
    sponsorship := 'offers';
  end if;
  if d = '' then sponsorship := 'unknown'; end if;

  restrictions := array(select distinct x.label from (values
    ('(us|u\.s\.|united states) citizen(s|ship)? (only|required)|must be a (us|u\.s\.) citizen', 'Citizens only'),
    ('(british|uk) (citizen|national)s? only|must be a (british|uk) (citizen|national)', 'Citizens only'),
    ('(canadian citizen|permanent resident) (only|required)|must be a canadian citizen', 'Citizens/PR only'),
    ('australian citizen(s|ship)? (only|required)|must be an australian citizen', 'Citizens only'),
    ('(active|current) (secret|top secret|ts/sci|security) clearance|security clearance (is )?required|sc clearance|dv clearance|baseline clearance', 'Security clearance'),
    ('green card holders? only|us persons? only|\yitar\y', 'US persons only')) x(pat, label)
    where a ~ x.pat);

  remote := t ~ '\yremote\y|work from home|\ywfh\y|anywhere in' or d ~ '\yfully remote\y|100% remote|remote-first';
end $$;
