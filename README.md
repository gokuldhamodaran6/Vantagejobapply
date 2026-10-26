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

## Apply agent

The agent applies on employers' official careers sites. It has two parts:

- **The app** (this Next.js service) decides everything: which jobs, what each field gets (`src/lib/agent/fields.ts`),
  tailored resume/cover letter PDFs, the job mailbox (IMAP, `src/lib/mail.ts`) and the encrypted vault (`src/lib/vault.ts`).
- **The worker** (`worker/`, Docker + Playwright) only drives a browser. It claims a task, fills the form page by page,
  creates accounts with the job email + a vault password, reads verification codes through the app, and hands any
  "I'm human" check to the user through a signed live view (`/live/:task`). It never stores credentials.

Environment:

| Service | Variable | Purpose |
|---|---|---|
| app | `VAULT_KEY` | 32-byte base64 key for AES-256-GCM secrets (back it up — losing it makes saved passwords unreadable) |
| app | `AGENT_SECRET` | Shared secret between app and worker |
| app | `WORKER_URL` | Public URL of the worker (to wake it and for live view) |
| app | `ANTHROPIC_API_KEY` | AI writing and form reasoning (`AI_WRITER_MODEL`, `AI_TAILOR_MODEL`, `AI_MODEL` optional) |
| worker | `APP_URL`, `AGENT_SECRET` | Where to fetch tasks |
| worker | `BROWSER_WS_ENDPOINT` | Optional: use a hosted browser (e.g. Browserbase) instead of local Chromium |

Test the whole loop locally against fixture sites (Greenhouse-, Ashby-, Workday-style and a human check): `npm run test:agent`.
