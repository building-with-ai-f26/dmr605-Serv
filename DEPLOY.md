# Putting Serv online

On a laptop Serv needs nothing but Node. Online it needs three things a laptop does not:
a paid AI key (a personal Claude subscription cannot serve other people), a database (a host
wipes the app's own disk on every deploy), and a cap on spending. The app refuses to start
online until the first two are set, and prints what is missing.

**Do not share the address with owners until the private views are in (row 2 of the trial plan).**
Until then the page has no sign-in: anyone with the address can read reports and tap Approve.

## 1. AI key (OpenRouter)

1. Create an account at https://openrouter.ai and add credits. $10 covers the trial at about 3 cents a report.
2. Create a key. In the key's settings, set a credit limit (for example $10). This is the hard stop on spending.
3. Keep the key for step 3. Never commit it.

## 2. Database (Supabase, free plan)

1. Create a project at https://supabase.com.
2. Open the SQL editor and run this once:

   ```sql
   create table app_state (
     id text primary key,
     doc jsonb not null,
     updated_at timestamptz not null default now()
   );
   -- Nothing may read or write this table except the app's own secret key.
   alter table app_state enable row level security;
   ```

3. From the project's API settings, copy the project URL and the secret key (called `service_role` on older projects). The secret key can read and write everything: it goes only in the host's settings, never in the browser or in Git.

All of Serv's data is one document in one row. That is enough for a 10-owner trial with one copy of the app running, and it is the same shape as the local `db.json`, so there is one code path to understand. It is not enough for many buildings; that is a later change.

## 3. Host

Any host that runs a container works. The repo's `Dockerfile` is all it needs. On Render:
New → Web Service → connect this repo → it finds the Dockerfile. Set the health check path to `/healthz`.

Set these in the host's environment settings:

| Setting | Value |
| --- | --- |
| `HOST` | `0.0.0.0` (the Dockerfile already sets it) |
| `AI_PROVIDER` | `openrouter` (the Dockerfile already sets it) |
| `OPENROUTER_API_KEY` | the key from step 1 |
| `SUPABASE_URL` | the project URL from step 2 |
| `SUPABASE_SERVICE_KEY` | the secret key from step 2 |
| `AI_DAILY_CALL_LIMIT` | optional; 200 a day if unset, about $6 at most |
| `POSTHOG_KEY` | the same public key as in `.env.example` |

The host sets `PORT` itself.

## What the spend cap does

Two limits, one inside the other. The app counts AI calls per day and answers "limit reached" after
`AI_DAILY_CALL_LIMIT`. The OpenRouter key's own credit limit stops everything if the app's count is ever wrong.

## Rolling back

Redeploy the previous commit from the host's dashboard. The data is in Supabase, so a redeploy does not touch it.
To start the data over, delete the row: `delete from app_state where id = 'main';` and restart the app.

## Not checked yet

This was tested against a stand-in for Supabase and for OpenRouter, not against real accounts, and the
container has not been built on a real host. The first real deploy is the test.
