# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Serv, the super for rental buildings too small to have one. A tenant reports a repair, one AI call matches it to a set price list using the building's file, Serv proposes one vetted pro at one price, and the owner approves in one tap.
- **Primary user & core workflow:** Owners of two- to four-family rental houses in Queens, and their tenants. See the living PRD in `docs/index.html`.
- **Tech stack:** Node.js 20 or newer, with no packages to install. Plain HTML, CSS and JavaScript in the browser. Data in one local JSON file. One AI call per tenant report, made by Claude Code in headless mode (`claude -p`) on this computer, using the builder's Claude subscription. OpenRouter is a second option. PostHog for analytics.

## 2. Structure

| Path | What it is |
| --- | --- |
| `app/server.mjs` | The local web server. Serves the page, reads `.env`, and exposes three private areas, each opened by a link and checked on every call: `/api/tenant/<unit link>` (the tenant's report, which makes the AI call, and the status of their own reports), `/api/owner/<building link>` (the owner's cards and one-tap decision), and `/api/staff/*` (password cookie: add buildings, file notes, queue). Pages: `/t/<link>`, `/o/<link>`, `/staff`. There is no open route that lists data. |
| `app/triage.mjs` | The AI call. Builds the prompt from the tenant's message, the building file and the price list, calls the AI, then checks the answer. Two providers: `claude-code` (default; starts `claude -p` in an empty scratch folder and sends the prompt on stdin) and `openrouter` (HTTPS). Anything out of range becomes "no match". |
| `app/dispatch.mjs` | Plain rules, no AI. Turns a checked triage into an offer (price from the list, nearest pro of that trade), a hand-off to a person, or an emergency. Records the owner's decision. |
| `app/pricelist.mjs` | The 20 set-price repairs. Prices are set here by hand, never by the model. |
| `app/store.mjs` | Buildings (each with an owner link, one link per unit, and a file), made-up demo data for laptops only, and the JSON file store. |
| `app/public/` | The pages: `tenant`, `owner`, `staff` (each `.html` plus `.js`), a small `index.html`, shared `style.css` and `common.js`, and `analytics.js` (PostHog loader that strips private links from every URL). |
| `app/test/app.test.mjs` | Automated tests. They use a fake AI, so they need no key and no network. |
| `app/data/db.json` | Created on first use. Ignored by Git. Delete it, or press "Reset demo", to start over. |
| `docs/` | The public Product Page (GitHub Pages): PRD and build log, with the PostHog web snippet in the `<head>` of `index.html`. `prototype.html` is the Build 1 prototype of the earlier marketplace idea. |
| `Dockerfile`, `DEPLOY.md` | How to put the app online: a paid AI key, a Supabase table for the data, and a daily cap on AI calls. Online, `app/store.mjs` keeps the same single document in Supabase instead of `db.json`. |
| `.env.example` | Every setting the app reads, with placeholders. Copy to `.env`. |

One user action, end to end: the browser posts the message (and a photo shrunk to 1280 px) to `POST /api/requests` → `triage.mjs` makes one AI call (Claude Code by default) → the JSON answer is checked → `dispatch.mjs` picks the price and pro → the request is saved and returned → the page shows the owner card → the owner's tap goes to `POST /api/requests/:id/decision` → an approved job is added to the building file.

## 3. Commands
- **Install dependencies:** the app itself needs none. Check Node with `node --version` (20 or newer). The AI call needs Claude Code: `npm install -g @anthropic-ai/claude-code`, then run `claude` once and sign in with your Claude account.
- **Set up settings (once):** `cp .env.example .env` (the PostHog key is already filled in; nothing else is required).
- **Run locally:** `npm start`, then open `http://localhost:3000`. Stop with Ctrl+C.
- **Run deterministic tests:** `npm test` (26 tests; they use a fake AI, so no sign-in or network is needed)
- **Run model evals:** none yet. Planned for Build 4 (10 tenant messages scored against the right price list line).
- **Product Page:** edit `docs/index.html` and push to `main`; GitHub Pages republishes it. Its PostHog snippet and public project token are in the `<head>`.

**On Windows (PowerShell):** type `npm.cmd` instead of `npm` and `claude.cmd` instead of `claude` if PowerShell refuses to run scripts, and use `copy .env.example .env`.

Settings read from `.env`: `AI_PROVIDER` (`claude-code` by default, or `openrouter`), `CLAUDE_MODEL` (optional), `CLAUDE_BIN` (optional path to the `claude` program), `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (only for `openrouter`), `POSTHOG_KEY`, `POSTHOG_HOST`, `PORT`. Online only: `HOST`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `AI_DAILY_CALL_LIMIT`.

**About cost:** with `claude-code` the call is covered by the Claude subscription, so nothing is billed per call. The app still shows what the same call would cost on the pay-per-call API (measured $0.02 to $0.035 for text, $0.06 with a photo). This setup is for the local demo only: a deployed app must call a paid API, because a personal subscription cannot serve other users.

## 4. Rules specific to this project
1. **The model reads, code decides.** The AI may classify a problem and write the reply to the tenant. It never sets a price, picks a pro, or approves anything. Keep those in `pricelist.mjs` and `dispatch.mjs`.
2. **Emergencies are never priced.** A `life_safety` triage must produce no offer. There is a test for this; keep it passing.
3. **No tenant text in analytics.** PostHog events carry outcomes and numbers, not the message. Replays mask typed input.
4. **Tell people they are recorded.** The page and the app both carry a line saying PostHog records visits. Keep it.
5. **Demo data is made up.** Do not put a real person's name, address or phone number in `store.mjs` or the docs.
6. **Private links are secrets.** A tenant never sees a price or the file; an owner sees only their building; links never go to analytics. Keep the tests for this passing.
7. **Keep the Claude Code call locked down.** `triage.mjs` starts `claude -p` with only the Read tool (no shell, no file edits), in an empty scratch folder, with this computer's own Claude Code settings, tools and commands switched off, and never with a flag that skips permission checks. Do not loosen this. Tenant messages are untrusted text, so assume one may try to give the model orders.
8. **No new dependencies without asking.** The app runs with nothing installed; that is a feature.

## 4b. Shipping (how the agent deploys)
Host: Render (Docker, uses the repo `Dockerfile`), database: Supabase (free plan), AI: OpenRouter. Details and settings table are in `DEPLOY.md`.
1. Branch from `main`, make the change, run `npm test` (57 tests must pass).
2. Search for secrets: `grep -rnE "sb_secret_|service_role|sk-or-|sk-ant-|sk-proj-|sk_live_" --exclude-dir=.git .` and confirm only placeholders and test fakes appear.
3. Open a pull request with the template filled in. Merge only after the human approves.
4. Render deploys `main`. After deploy, check `/healthz` returns `{"ok":true}`, open a unit link on a phone, send one report, and approve it as the owner.
5. Check PostHog shows the pageview and a session replay from the live URL.
6. Roll back by redeploying the previous commit in Render. Data lives in Supabase and is untouched.

## 4c. Ask me first (stop and wait for the human)
- Deleting data, dropping or changing tables, or running any SQL against the production database.
- Anything touching keys, secrets, environment variables, or permissions (including the Supabase secret key and the OpenRouter key).
- Anything that costs money: credits, paid plans, raising a spending cap.
- Changing the host, the DNS or the public URL, and force-pushing.

## 4d. Rules learned from agent mistakes
- **Run every command before writing it down.** In Build 2 the agent wrote `npm test` to point at a folder Node could not run, and the tests never ran. Name test files explicitly in `package.json` and run the command once before saying it works.
- **Do not assume an account or credits exist.** The agent chose OpenRouter without checking that credits were available; ask before picking a paid provider.

## 5. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
