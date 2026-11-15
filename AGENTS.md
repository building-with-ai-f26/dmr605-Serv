# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Serv, the super for rental buildings too small to have one. A tenant reports a repair, one AI call matches it to a set price list using the building's file, Serv proposes one vetted pro at one price, and the owner approves in one tap.
- **Primary user & core workflow:** Owners of two- to four-family rental houses in Queens, and their tenants. See the living PRD in `docs/index.html`.
- **Tech stack:** Node.js 20 or newer, with no packages to install. Plain HTML, CSS and JavaScript in the browser. Data in one local JSON file. One AI call per tenant report, through the OpenRouter API to Claude. PostHog for analytics.

## 2. Structure

| Path | What it is |
| --- | --- |
| `app/server.mjs` | The local web server. Serves the page, reads `.env`, and exposes four routes: `GET /api/state`, `POST /api/requests` (the tenant's report, which makes the AI call), `POST /api/requests/:id/decision` (the owner's tap), `POST /api/reset`. |
| `app/triage.mjs` | The AI call. Builds the prompt from the tenant's message, the building file and the price list, calls OpenRouter, then checks the answer. Anything out of range becomes "no match". |
| `app/dispatch.mjs` | Plain rules, no AI. Turns a checked triage into an offer (price from the list, nearest pro of that trade), a hand-off to a person, or an emergency. Records the owner's decision. |
| `app/pricelist.mjs` | The 20 set-price repairs. Prices are set here by hand, never by the model. |
| `app/store.mjs` | Demo data (one building, its file, four pros) and the JSON file store. |
| `app/public/` | The page: `index.html`, `app.js`, `style.css`, and `analytics.js` (PostHog loader). |
| `app/test/app.test.mjs` | Automated tests. They use a fake AI, so they need no key and no network. |
| `app/data/db.json` | Created on first use. Ignored by Git. Delete it, or press "Reset demo", to start over. |
| `docs/` | The public Product Page (GitHub Pages): PRD, build log, `config.js` (PostHog key for the page), and a copy of `analytics.js`. `prototype.html` is the Build 1 prototype of the earlier marketplace idea. |
| `.env.example` | Every setting the app reads, with placeholders. Copy to `.env`. |

One user action, end to end: the browser posts the message (and a photo shrunk to 1280 px) to `POST /api/requests` → `triage.mjs` sends one request to OpenRouter → the JSON answer is checked → `dispatch.mjs` picks the price and pro → the request is saved and returned → the page shows the owner card → the owner's tap goes to `POST /api/requests/:id/decision` → an approved job is added to the building file.

## 3. Commands
- **Install dependencies:** none. Check Node with `node --version` (20 or newer).
- **Set up keys (once):** `cp .env.example .env`, then open `.env` and paste your OpenRouter key after `OPENROUTER_API_KEY=` and your PostHog project key (starts with `phc_`) after `POSTHOG_KEY=`.
- **Run locally:** `npm start`, then open `http://localhost:3000`. Stop with Ctrl+C.
- **Run deterministic tests:** `npm test`
- **Run model evals:** none yet. Planned for Build 4 (10 tenant messages scored against the right price list line).
- **Product Page:** edit `docs/index.html` and push to `main`; GitHub Pages republishes it. Its PostHog key goes in `docs/config.js`.

Settings read from `.env`: `OPENROUTER_API_KEY` (required), `OPENROUTER_MODEL` (optional; empty picks the newest Claude Opus that OpenRouter lists), `POSTHOG_KEY`, `POSTHOG_HOST`, `PORT`.

## 4. Rules specific to this project
1. **The model reads, code decides.** The AI may classify a problem and write the reply to the tenant. It never sets a price, picks a pro, or approves anything. Keep those in `pricelist.mjs` and `dispatch.mjs`.
2. **Emergencies are never priced.** A `life_safety` triage must produce no offer. There is a test for this; keep it passing.
3. **No tenant text in analytics.** PostHog events carry outcomes and numbers, not the message. Replays mask typed input.
4. **Keep `app/public/analytics.js` and `docs/analytics.js` identical.**
5. **Demo data is made up.** Do not put a real person's name, address or phone number in `store.mjs` or the docs.
6. **No new dependencies without asking.** The app runs with nothing installed; that is a feature.

## 5. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
