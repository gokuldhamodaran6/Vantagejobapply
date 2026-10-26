# Vantage — jobs abroad that can actually hire you

Vantage finds live jobs on employers' **official careers systems**, filters out roles a user can't legally take (visa sponsorship, citizenship, clearance, occupation rules per country), writes an ATS-ready resume and cover letter per role, and tracks every application.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4, Motion) on **Render**
- **Supabase**: auth, Postgres with row-level security, scheduled jobs (pg_cron + pg_net)
- Optional: **Claude API** for tailoring/import/agent answers (rule-based fallbacks work without it), **Stripe** for billing

## How jobs are sourced

Only from employers' own careers systems — never aggregators:
Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee and Workday. Every "Apply" link opens the official posting.

- `boards` table = the employers being watched. Seeded with ~45; grows when users add target companies
  (`/api/companies` auto-detects the careers system by name, or reads it from any pasted job link).
- `/api/cron/ingest?task=boards|enrich|uk_sponsors|prune|all` (header `x-cron-secret`) refreshes everything.
  Target companies are also refreshed live when a user opens their feed (if older than 20 minutes).
- UK jobs are checked against the Home Office **Register of Licensed Sponsors** (downloaded daily).

## Eligibility engine

`src/lib/jobs/match.ts` scores each job against the user's target roles, levels, cities, industries, salary and
per-country work authorisation. `src/lib/countries.ts` holds country rules (reviewed October 2026) with official sources.
Users always see why a job was hidden.

## Key folders

```
src/app/              pages (landing, auth, onboarding, /app/*, /admin) and API routes
src/lib/jobs/         sources (ATS clients), signals (text analysis), match (scoring), engine (search)
src/lib/ats.ts        ATS resume scoring and plain-text resume parsing
src/lib/tailor.ts     resume/cover-letter tailoring (Claude + rule-based fallback)
src/lib/assistant.ts  "Ask your agent" intents and answers
```

## Run locally

```bash
cp .env.example .env.local   # fill INGEST_SECRET at least
npm install
npm run dev
```

## Admin

The account `gokuldhamodaran6@gmail.com` becomes admin automatically on signup and gets `/admin`
(users, plans, revenue estimate, job-source health, manual data syncs).
