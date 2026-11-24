# SECURITY.md: Serv security audit (Build 3)

**Lane:** Beginner. **App type:** no sign-in, saves data, and calls a paid AI API. Owners and tenants open private links; staff use one password. All writes go through the server, never from the browser to the database.

**Live URL:** https://dmr605-serv.onrender.com (Render, Docker; Supabase database; OpenRouter free model on a $0 key).

**Status (Nov 24):** local and live-site checks are done and passed. Still PENDING: the Supabase public-key insert/delete test (run in the browser console, commands under "Live test") and the manual database backup.

## What I checked

| # | Check | Result |
| --- | --- | --- |
| 1 | Access controls (no sign-in, saved data) | Local: PASS. Live insert/delete with the public key: PENDING (see below) |
| 2 | Secret key search, repo | PASS (see below) |
| 2 | Secret key search, live site | PASS (see below) |
| 3 | File storage | N/A. Photos are shrunk in the browser and kept inside the one JSON document; no storage bucket |
| 4 | Protect production from the agent | Ask-me-first list in `AGENTS.md`; manual Supabase backup PENDING (command below) |
| 5 | Spending caps and rate limits | In code: PASS. OpenRouter credit limit PENDING |
| 6 | Dependencies | PASS: no packages (`package.json` has no dependencies), so `npm audit` has nothing to flag |
| 7 | Agent security review | Done, see attack log |

## Access control design
- Nothing is readable from the browser's database key. The browser never talks to Supabase. The `app_state` table has Row Level Security on and no policies, so the public (anon) key can neither read nor write it. Only the server, holding the secret key, can.
- No route lists data. Owner pages need a private building link, tenant pages a private unit link, staff routes a password cookie.
- Staff cookie is `HttpOnly; SameSite=Strict; Secure` online, and compared in constant time.

## Secret key search (repo)
Searched the repo for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_`. Hits: only placeholders in `.env.example` (`sk-or-v1-replace-with-your-key`), fake values in `app/test/`, and the words `service_role` in `DEPLOY.md` instructions. No real key. The PostHog `phc_` key is public by design. `.env` is in `.gitignore`.
Live-site search (PASS, Nov 24): fetched `/`, `/config.js`, `/common.js`, `/analytics.js`, `/tenant.js`, `/owner.js`, `/staff.js`, `/style.css` from the live URL; none contain any of the patterns. `/config.js` carries only the public PostHog `phc_` key. Command used: `curl -s https://<live-url>/ https://<live-url>/config.js https://<live-url>/*.js | grep -E "sb_secret_|service_role|sk-or-|sk-ant-|sk-proj-|sk_live_"` must print nothing.

## Attack log (run against the app locally on Nov 24)
| Attack | What happened |
| --- | --- |
| Guess list routes (`/api/buildings`, `/api/requests`, `/api/owner`, `/api/tenant`) | 404, no data |
| `/api/staff/buildings`, `/api/staff/queue` with no sign-in | 401 |
| Guessed owner and unit links | 404 "This link is not working" |
| Path traversal (`/../../etc/passwd`, `%2e%2e`), request for `data/db.json` and `server.mjs` | 404 on all |
| 12 wrong staff passwords in a row | first 10 got 401, then 429 "Too many tries" |
| Forged staff cookie (`serv_staff=open`) | 401 |
| Per-unit report cap and daily AI cap | covered by the existing automated tests (57 pass) |

## Live-site attack results (https://dmr605-serv.onrender.com, Nov 24)
`/api/buildings`, `/api/requests`, `/api/owner`, `/api/tenant`, `/data/db.json`, `/app/server.mjs` all 404; `/api/staff/buildings` and `/api/staff/queue` 401; a guessed owner link 404. Response headers include `nosniff` and `X-Frame-Options: DENY`.

## Found and fixed
- Nothing exploitable found in the local or live pass.
- Deploy bug, not a security hole: the first Render start failed with Supabase 403 (42501) because the SQL lacked `grant ... to service_role`. Fixed in `DEPLOY.md`. This also confirms the table is closed to everything except the server's role.

## Remaining issues (honest list)
1. The Supabase public-key insert/delete test and the manual backup still need to be run and screenshotted (see below).
2. No Content-Security-Policy header yet. Other headers (`nosniff`, `X-Frame-Options`, `no-referrer`) are set.
3. Everything is one JSON document in one row: fine for a 10-owner trial, not for scale. Photos inflate it.
4. Per-visitor rate limits are per unit link and per staff login attempt, not per IP, on the report route.
5. Single staff password, no per-person accounts.

## Live test (run after deploy, with the project's public `sb_publishable_` / anon key)
Back up first (`select * from app_state;` exported as JSON from the Supabase SQL editor). Then in the browser console on the live site:
```js
const u = 'https://<project>.supabase.co/rest/v1/app_state', k = '<publishable key>';
const h = { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', Prefer: 'return=representation' };
await fetch(u, { method: 'POST', headers: h, body: JSON.stringify({ id: 'sectest', doc: {} }) }).then(r => r.status);   // expect 401/403 (rejected)
await fetch(u + '?id=eq.main', { method: 'DELETE', headers: h }).then(async r => [r.status, await r.text()]);        // expect no rows affected
```
Screenshot the two results for submission.
