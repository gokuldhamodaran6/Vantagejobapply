# Chrome Web Store — Vantage extension

Everything needed to publish the extension under **your own** Chrome Web Store developer account
(https://chrome.google.com/webstore/devconsole — one-time $5 registration fee). Vantage can't publish it for you.

## Files

| File | Use |
| --- | --- |
| `vantage-extension-store-<version>.zip` | Upload this (Package → Upload new package). Built by `node extension/build.mjs`; same as the download in Vantage but without the `key` field, which the store refuses. |
| `screenshot-1-fill-here.png` (1280×800) | Store screenshot 1 |
| `screenshot-2-filled.png` (1280×800) | Store screenshot 2 |
| `promo-tile-440x280.png` | Small promo tile |
| `../icons/128.png` | Store icon (128×128) |

Re-render the images with `node extension/store/shots.mjs` (made-up applicant "Priya Raman"; no real data).

## Store listing

**Name:** Vantage — Fill job applications

**Summary (≤132 characters):**
Fills job applications on company careers sites with your profile, saved answers and a tailored resume. You press Submit.

**Category:** Workflow & Planning (or Tools) · **Language:** English

**Description:**

> Vantage fills job applications for you on companies' own careers sites — Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, Workable and most others.
>
> • One click fills every page: contact details, work history, education, questions you've answered before, and a resume and cover letter tailored to that job.
> • Answer a new question once — Vantage remembers it, and recognises it next time even when another company words it differently.
> • You stay in control: you check every page and press Submit yourself (or tell Vantage to press it). Nothing is sent without you.
> • Private answers stay private: work-authorisation and voluntary equal-opportunity answers are typed by Vantage itself and never shown to AI.
> • Every application is added to your Vantage tracker automatically.
>
> Requires a Vantage account (https://vantage-app-aht2.onrender.com). Vantage never types your own passwords, never solves CAPTCHAs, and stops on sites that ask applicants not to use automated tools.

**Website:** https://vantage-app-aht2.onrender.com · **Support:** your support email
**Privacy policy URL:** https://vantage-app-aht2.onrender.com/legal/privacy (section "The Vantage Chrome extension")

## Privacy practices tab

**Single purpose:** Fill job application forms on employers' careers sites with the user's own Vantage profile, saved answers and tailored resume, when the user asks.

**Permission justifications:**

- `activeTab` / `scripting` — read the application form on the tab the user chooses and type the user's answers into it.
- `tabs` — know which tab the user asked to fill, and keep filling when the application moves to its next page.
- `storage` — keep the user's Vantage sign-in key and the state of the application in progress.
- Host permission `<all_urls>` and the content script on `https://*/*` — job applications are hosted on each employer's own careers domain (thousands of different sites), so the extension must be able to fill forms on any https site. On known careers systems it only shows an "Apply with Vantage" button; it reads and fills a page only after the user clicks.
- Remote code: **No.** All code ships in the package; Vantage's server returns data (which answer goes in which field), never code.

**Data usage — check:** Personally identifiable information, Authentication information (Vantage sign-in key only), Website content (the application form being filled).
**Do not check:** Health, Financial, Personal communications, Location, Web history, User activity.

Certify all three: not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## After it's published

1. Copy the extension ID the store assigns (Developer Dashboard → the item → ID).
2. In Render → the Vantage app → Environment, add `NEXT_PUBLIC_EXT_STORE_ID=<that id>` and redeploy. The Extension page then works with both the store copy and the downloaded copy.
3. Optional: point the Extension page's install button at the store listing URL.
